import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const MEALDB_BASE_URL = 'https://www.themealdb.com/api/json/v1/1';
const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY || '';
const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com';
const USDA_API_KEY = process.env.FDC_API_KEY || process.env.USDA_API_KEY || '';
const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.use(cors());
app.use(express.json());

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Request failed (${response.status}): ${message}`);
  }
  return response.json();
};

const fetchFromMealDb = (endpoint) => fetchJson(`${MEALDB_BASE_URL}${endpoint}`);

const buildSpoonacularUrl = (path, params = {}) => {
  if (!SPOONACULAR_API_KEY) {
    throw new Error('Spoonacular API key is not configured');
  }
  const url = new URL(`${SPOONACULAR_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, value);
    }
  });
  url.searchParams.set('apiKey', SPOONACULAR_API_KEY);
  return url;
};

const fetchFromSpoonacular = (path, params) => fetchJson(buildSpoonacularUrl(path, params));
const buildUsdaUrl = (path, params = {}) => {
  if (!USDA_API_KEY) {
    throw new Error('USDA API key is not configured');
  }
  const url = new URL(`${USDA_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, value);
    }
  });
  url.searchParams.set('api_key', USDA_API_KEY);
  return url;
};

const fetchFromUsda = (path, params) => fetchJson(buildUsdaUrl(path, params));

const withSafeFetch = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    return { error: error.message };
  }
};

const normalizeSource = (source = 'both') => {
  const value = source.toString().toLowerCase();
  if (['mealdb', 'spoonacular', 'both'].includes(value)) {
    return value;
  }
  return 'both';
};

const sanitizeCsv = (value = '') =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(',');

const mapComplexSearchResult = (entry = {}) => ({
  id: entry.id,
  title: entry.title,
  image: entry.image,
  sourceUrl: entry.sourceUrl,
  readyInMinutes: entry.readyInMinutes,
  servings: entry.servings,
  usedIngredients: entry.usedIngredients ?? entry.extendedIngredients ?? [],
  missedIngredients: entry.missedIngredients ?? [],
  unusedIngredients: entry.unusedIngredients ?? [],
});

const getMealDetail = async (id, sourcePreference = 'mealdb') => {
  const selectedSource = normalizeSource(sourcePreference === 'both' ? 'mealdb' : sourcePreference);
  if (selectedSource === 'spoonacular') {
    const meal = await fetchFromSpoonacular(`/recipes/${id}/information`, { includeNutrition: true });
    return { source: 'spoonacular', meal };
  }
  const data = await fetchFromMealDb(`/lookup.php?i=${id}`);
  const meal = data?.meals?.[0];
  if (!meal) {
    throw new Error('Recipe not found');
  }
  return { source: 'mealdb', meal };
};

const normalizeMealIngredients = (meal, source) => {
  if (source === 'spoonacular') {
    return (meal?.extendedIngredients ?? [])
      .map((ingredient) => {
        if (ingredient.original) return ingredient.original;
        const parts = [ingredient.amount, ingredient.unit, ingredient.name].filter(Boolean);
        return parts.join(' ').trim();
      })
      .filter(Boolean);
  }

  return Array.from({ length: 20 }, (_, index) => {
    const name = meal?.[`strIngredient${index + 1}`];
    const quantity = meal?.[`strMeasure${index + 1}`];
    if (!name || !name.trim()) return null;
    const trimmedName = name.trim();
    const trimmedQuantity = quantity?.trim();
    return trimmedQuantity ? `${trimmedQuantity} ${trimmedName}` : trimmedName;
  }).filter(Boolean);
};

const normalizeMealSteps = (meal, source) => {
  if (source === 'spoonacular') {
    const analyzed = meal?.analyzedInstructions ?? [];
    const steps = analyzed.flatMap((block) => block.steps ?? []).map((step) => step.step).filter(Boolean);
    if (steps.length) return steps;
    if (meal?.instructions) {
      return meal.instructions
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    }
    return [];
  }

  if (!meal?.strInstructions) return [];
  return meal.strInstructions
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
};

const buildSoraPrompt = (recipeName, ingredients, steps) => {
  const ingredientsList = ingredients.map((item) => `- ${item}`).join('\n');
  const stepsList = steps.map((step, index) => `${index + 1}. ${step}`).join('\n');

  return `
Create a top-down cooking instruction video showing how to make the recipe: "${recipeName}".

Ingredients visible in the scenes:
${ingredientsList}

The video should follow these steps in order:
${stepsList}

For each step, show only hands and utensils in a modern, well-lit kitchen. 
No faces, no identifiable humans.

Video style:
- Bright natural lighting
- Wooden cutting board
- Stainless steel pots, pans, and tools
- Smooth camera movement
- Clear close-ups for chopping, mixing, and cooking
- Audible light kitchen ambience (no copyrighted music)

Focus on visually demonstrating the actions exactly as described in the steps:
${stepsList}

End the video by showing the completed dish nicely plated.
`.trim();
};

app.get('/api/recipes', async (req, res) => {
  const { ingredients, number = 12, source = 'both', diet = '', intolerances = '' } = req.query;
  const sanitizedIngredients = sanitizeCsv(ingredients);
  if (!sanitizedIngredients) {
    return res.status(400).json({ error: 'Ingredients query parameter is required' });
  }

  const selectedSource = normalizeSource(source);
  const includeMealDb = selectedSource === 'mealdb' || selectedSource === 'both';
  const includeSpoonacular = selectedSource === 'spoonacular' || selectedSource === 'both';

  const payload = {
    source: selectedSource,
    mealdb: [],
    spoonacular: [],
    errors: {},
  };

  const tasks = [];

  if (includeMealDb) {
    tasks.push(
      withSafeFetch(async () => {
        const data = await fetchFromMealDb(`/filter.php?i=${encodeURIComponent(sanitizedIngredients)}`);
        payload.mealdb = data?.meals ?? [];
      }).then((result) => {
        if (result?.error) {
          payload.errors.mealdb = result.error;
        }
      }),
    );
  }

  if (includeSpoonacular) {
    tasks.push(
      withSafeFetch(async () => {
        const hasDietFilter = Boolean(diet || intolerances);
        if (hasDietFilter) {
          const complexSearch = await fetchFromSpoonacular('/recipes/complexSearch', {
            includeIngredients: sanitizedIngredients,
            diet: diet || undefined,
            intolerances: intolerances || undefined,
            number,
            fillIngredients: true,
            instructionsRequired: true,
            addRecipeInformation: true,
          });
          const results = Array.isArray(complexSearch?.results) ? complexSearch.results : [];
          payload.spoonacular = results.map(mapComplexSearchResult);
          return;
        }

        const data = await fetchFromSpoonacular('/recipes/findByIngredients', {
          ingredients: sanitizedIngredients,
          number,
          ranking: 1,
        });
        payload.spoonacular = Array.isArray(data) ? data : [];
      }).then((result) => {
        if (result?.error) {
          payload.errors.spoonacular = result.error;
        }
      }),
    );
  }

  await Promise.all(tasks);

  if (!payload.mealdb.length && !payload.spoonacular.length) {
    const status = Object.keys(payload.errors).length ? 502 : 404;
    return res.status(status).json({ error: 'No recipes found', details: payload });
  }

  return res.json(payload);
});

app.get('/api/recipes/:id', async (req, res) => {
  const { id } = req.params;
  const { source = 'mealdb' } = req.query;
  const detail = await withSafeFetch(async () => getMealDetail(id, source));
  if (detail?.error) {
    const status = detail.error === 'Recipe not found' ? 404 : 502;
    return res.status(status).json({ error: detail.error });
  }
  return res.json(detail);
});

app.get('/api/cuisines', async (_req, res) => {
  const data = await withSafeFetch(async () => fetchFromMealDb('/list.php?a=list'));
  if (data?.error) {
    return res.status(502).json({ error: data.error });
  }
  return res.json(data);
});

app.get('/api/recipes/area/:area', async (req, res) => {
  const { area } = req.params;
  const data = await withSafeFetch(async () =>
    fetchFromMealDb(`/filter.php?a=${encodeURIComponent(area)}`),
  );
  if (data?.error) {
    return res.status(502).json({ error: data.error });
  }
  return res.json(data);
});

app.get('/api/random', async (req, res) => {
  const { source = 'mealdb', diet = '', tags = '' } = req.query;
  const selectedSource = normalizeSource(source);
  const includeMealDb = selectedSource === 'mealdb' || selectedSource === 'both';
  const includeSpoonacular = selectedSource === 'spoonacular' || selectedSource === 'both';

  const payload = {
    source: selectedSource,
    mealdb: [],
    spoonacular: [],
    errors: {},
  };

  const tasks = [];

  if (includeMealDb) {
    tasks.push(
      withSafeFetch(async () => {
        const data = await fetchFromMealDb('/random.php');
        payload.mealdb = data?.meals ?? [];
      }).then((result) => {
        if (result?.error) {
          payload.errors.mealdb = result.error;
        }
      }),
    );
  }

  if (includeSpoonacular) {
    tasks.push(
      withSafeFetch(async () => {
        const randomTags = sanitizeCsv(tags) || sanitizeCsv(diet);
        const data = await fetchFromSpoonacular('/recipes/random', {
          number: 1,
          tags: randomTags || undefined,
        });
        payload.spoonacular = data?.recipes ?? [];
      }).then((result) => {
        if (result?.error) {
          payload.errors.spoonacular = result.error;
        }
      }),
    );
  }

  await Promise.all(tasks);

  if (!payload.mealdb.length && !payload.spoonacular.length) {
    const status = Object.keys(payload.errors).length ? 502 : 404;
    return res.status(status).json({ error: 'No random recipes available', details: payload });
  }

  return res.json(payload);
});

app.get('/api/spoonacular/autocomplete', async (req, res) => {
  const { query, number = 5 } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  const result = await withSafeFetch(async () =>
    fetchFromSpoonacular('/recipes/autocomplete', { query, number }),
  );
  if (result?.error) {
    return res.status(502).json({ error: result.error });
  }
  return res.json(result);
});

app.get('/api/spoonacular/search', async (req, res) => {
  const { query = '', diet, intolerances, number = 10 } = req.query;
  if (!query && !diet && !intolerances) {
    return res
      .status(400)
      .json({ error: 'Provide at least one of query, diet, or intolerances to search.' });
  }
  const result = await withSafeFetch(async () =>
    fetchFromSpoonacular('/recipes/complexSearch', {
      query,
      diet,
      intolerances,
      number,
      addRecipeInformation: true,
    }),
  );
  if (result?.error) {
    return res.status(502).json({ error: result.error });
  }
  return res.json(result);
});

app.get('/api/usda/search', async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }
  const data = await withSafeFetch(async () =>
    fetchFromUsda('/foods/search', {
      query,
      pageSize: 1,
      requireAllWords: false,
    }),
  );
  if (data?.error) {
    return res.status(502).json({ error: data.error });
  }
  return res.json(data);
});

app.post('/api/video', async (req, res) => {
  const { recipeId, source = 'mealdb', preview = false } = req.body;
  if (!recipeId) {
    return res.status(400).json({ error: 'recipeId is required' });
  }

  const detail = await withSafeFetch(async () => getMealDetail(recipeId, source));
  if (detail?.error) {
    const status = detail.error === 'Recipe not found' ? 404 : 502;
    return res.status(status).json({ error: detail.error });
  }

  const recipeName =
    detail.source === 'spoonacular' ? detail.meal.title : detail.meal.strMeal || 'MealMatch Recipe';
  const ingredients = normalizeMealIngredients(detail.meal, detail.source);
  const steps = normalizeMealSteps(detail.meal, detail.source);

  if (!ingredients.length || !steps.length) {
    return res.status(400).json({ error: 'Recipe is missing ingredients or steps for video generation' });
  }

  const soraPrompt = buildSoraPrompt(recipeName, ingredients, steps);

  if (preview || !openaiClient) {
    return res.json({
      prompt: soraPrompt,
      video: null,
      preview: true,
      missingApiKey: !openaiClient,
    });
  }

  const videoResponse = await withSafeFetch(async () =>
    openaiClient.videos.create({
      model: 'sora-2',
      prompt: soraPrompt,
    }),
  );

  if (videoResponse?.error) {
    return res.status(502).json({ error: 'Failed to generate video', details: videoResponse.error, prompt: soraPrompt });
  }

  return res.json({ prompt: soraPrompt, video: videoResponse });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
