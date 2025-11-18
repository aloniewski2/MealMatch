export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
export const PANTRY_KEY = 'mealMatchPantry';

export const sanitizeIngredients = (input = '') =>
  input
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .join(',');

export const stripHtml = (text = '') => text.replace(/<[^>]*>/g, '').trim();

export const toSummary = (data, source) => {
  if (!data) return null;
  if (source === 'spoonacular') {
    return {
      id: data.id,
      title: data.title,
      image: data.image,
      source,
      sourceUrl: data.sourceUrl,
    };
  }
  return {
    id: data.idMeal,
    title: data.strMeal,
    image: data.strMealThumb,
    source: 'mealdb',
    sourceUrl: data.strSource || data.strYoutube || '',
  };
};

export const buildFavoriteKey = (favorite) => `${favorite.source}-${favorite.id}`;

export const normalizeFavorite = (item) => {
  if (!item) return null;
  if (item.source && item.id) {
    return {
      id: item.id,
      title: item.title,
      image: item.image,
      source: item.source,
      sourceUrl: item.sourceUrl || '',
    };
  }
  if (item.idMeal || item.strMeal) {
    return {
      id: item.idMeal,
      title: item.strMeal,
      image: item.strMealThumb,
      source: 'mealdb',
      sourceUrl: item.strSource || item.strYoutube || '',
    };
  }
  return null;
};

export const buildCardsFromPayload = (payload) => {
  if (!payload) return [];
  const cards = [];

  (payload.spoonacular ?? []).forEach((item) => {
    cards.push({
      id: item.id,
      title: item.title,
      image: item.image,
      source: 'spoonacular',
      sourceUrl: item.sourceUrl,
      readyInMinutes: item.readyInMinutes ?? null,
      servings: item.servings ?? null,
      usedIngredients: item.usedIngredients ?? item.extendedIngredients ?? [],
      missedIngredients: item.missedIngredients ?? [],
      unusedIngredients: item.unusedIngredients ?? [],
    });
  });

  (payload.mealdb ?? []).forEach((item) => {
    cards.push({
      id: item.idMeal,
      title: item.strMeal,
      image: item.strMealThumb,
      source: 'mealdb',
      sourceUrl: item.strSource || item.strYoutube,
      readyInMinutes: null,
      servings: null,
      usedIngredients: [],
      missedIngredients: [],
      unusedIngredients: [],
    });
  });

  return cards;
};

export const buildIngredientList = (selectedMeal, servingTarget) => {
  if (!selectedMeal?.data) return [];
  if (selectedMeal.source === 'spoonacular') {
    const baseServings = selectedMeal.data.servings || 1;
    const targetServings = servingTarget || baseServings;
    const scale = baseServings ? targetServings / baseServings : 1;

    return (selectedMeal.data.extendedIngredients ?? [])
      .map((ingredient) => {
        const baseAmount =
          typeof ingredient.amount === 'number'
            ? ingredient.amount
            : ingredient.measures?.us?.amount ?? ingredient.measures?.metric?.amount;
        const unit =
          ingredient.unit || ingredient.measures?.us?.unitShort || ingredient.measures?.metric?.unitShort || '';

        if (typeof baseAmount === 'number') {
          const scaled = Math.round(baseAmount * scale * 100) / 100;
          const displayAmount = Number.isInteger(scaled) ? scaled : scaled.toFixed(2);
          const label = ingredient.nameClean || ingredient.originalName || ingredient.name;
          return `${displayAmount} ${unit}`.trim() + (label ? ` ${label}` : '');
        }
        return ingredient.original || ingredient.originalName || ingredient.name;
      })
      .filter(Boolean);
  }

  return Array.from({ length: 20 }, (_, index) => {
    const ingredient = selectedMeal.data[`strIngredient${index + 1}`];
    const measure = selectedMeal.data[`strMeasure${index + 1}`];
    if (!ingredient || !ingredient.trim()) return null;
    return `${ingredient}${measure ? ` - ${measure.trim()}` : ''}`;
  }).filter(Boolean);
};

export const buildInstructionsText = (selectedMeal) => {
  if (!selectedMeal?.data) return 'Instructions not available.';
  if (selectedMeal.source === 'spoonacular') {
    const instructions = selectedMeal.data.analyzedInstructions ?? [];
    const steps = instructions.flatMap((group) => group.steps ?? []);
    if (steps.length) {
      return steps
        .map((step) => `${step.number}. ${step.step}`)
        .join('\n');
    }
    return selectedMeal.data.instructions || 'Instructions not available.';
  }
  return selectedMeal.data.strInstructions || 'Instructions not available.';
};

export const getMetadataChips = (selectedMeal) => {
  if (!selectedMeal?.data) return [];
  if (selectedMeal.source === 'spoonacular') {
    const chips = [];
    if (selectedMeal.data.readyInMinutes) {
      chips.push(`${selectedMeal.data.readyInMinutes} min`);
    }
    if (selectedMeal.data.servings) {
      chips.push(`${selectedMeal.data.servings} servings`);
    }
    const cuisines = selectedMeal.data.cuisines ?? [];
    if (cuisines.length) chips.push(...cuisines);
    const diets = selectedMeal.data.diets ?? [];
    if (diets.length) chips.push(...diets);
    return chips;
  }

  return [selectedMeal.data.strCategory, selectedMeal.data.strArea].filter(Boolean);
};

const SUBSTITUTION_MAP = {
  butter: ['Olive oil', 'Coconut oil', 'Vegan margarine'],
  milk: ['Almond milk', 'Oat milk', 'Coconut milk'],
  cream: ['Half-and-half', 'Greek yogurt + milk', 'Coconut cream'],
  sourcream: ['Greek yogurt', 'Crème fraîche'],
  sour: ['Greek yogurt', 'Crème fraîche'],
  yogurt: ['Sour cream', 'Coconut yogurt'],
  egg: ['Flax egg', 'Chia egg', 'Unsweetened applesauce'],
  eggs: ['Flax egg', 'Chia egg', 'Unsweetened applesauce'],
  sugar: ['Honey', 'Maple syrup', 'Coconut sugar'],
  flour: ['Almond flour', 'Oat flour', 'Gluten-free blend'],
};

export const getIngredientSubstitutions = (ingredientName = '') => {
  const key = ingredientName.toLowerCase().replace(/\s+/g, '');
  const exact = SUBSTITUTION_MAP[key];
  if (exact) return exact;
  const partial = Object.entries(SUBSTITUTION_MAP).find(([base]) => key.includes(base));
  return partial ? partial[1] : [];
};
