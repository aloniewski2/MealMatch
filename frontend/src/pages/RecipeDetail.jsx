import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  API_BASE_URL,
  buildFavoriteKey,
  buildIngredientList,
  buildInstructionsText,
  getIngredientSubstitutions,
  getMetadataChips,
  stripHtml,
  toSummary,
} from '../utils/recipeUtils.js';
import { useMealMatch } from '../context/MealMatchContext.jsx';
import '../index.css';

const COOKING_MODE_GUIDES = {
  oven: {
    label: 'Oven / Bake',
    tempDelta: 'Standard directions',
    timeDelta: 'Use original bake times.',
    notes: 'Great for casseroles, sheet pans, and roasting. Preheat fully before placing food inside.',
  },
  airfryer: {
    label: 'Air Fryer',
    tempDelta: 'Reduce temperature by 25°F / 15°C.',
    timeDelta: 'Reduce cook time by ~20% and check halfway.',
    notes: 'Arrange food in a single layer and shake the basket for even crisping.',
  },
  stovetop: {
    label: 'Stovetop / Skillet',
    tempDelta: 'Use medium heat unless otherwise noted.',
    timeDelta: 'Simmer until internal temps match the recipe.',
    notes: 'Stir frequently and use a lid to retain moisture when needed.',
  },
  slowcooker: {
    label: 'Slow Cooker',
    tempDelta: 'Cook on LOW 6–8 hrs or HIGH 3–4 hrs.',
    timeDelta: 'No preheating necessary; add liquids to prevent sticking.',
    notes: 'Layer hearty vegetables at the bottom and keep the lid closed.',
  },
};

const RecipeDetail = () => {
  const { id, source } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const cardMeta = location.state?.card;
  const {
    favoriteIds,
    toggleFavorite,
    addShoppingItems,
    shoppingList,
    removeShoppingItem,
    clearShoppingList,
  } = useMealMatch();

  const [detail, setDetail] = useState(null);
  const [servingTarget, setServingTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [cookingMode, setCookingMode] = useState('oven');
  const [completedSteps, setCompletedSteps] = useState(() => new Set());

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/recipes/${id}?source=${source}`);
      if (!response.ok) {
        throw new Error('Unable to load recipe details');
      }
      const data = await response.json();
      if (data?.error) {
        throw new Error(data.error);
      }
      setDetail({ source: data.source, data: data.meal });
      setServingTarget(data.meal?.servings || null);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Unable to load recipe details');
    } finally {
      setLoading(false);
    }
  }, [id, source]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const selectedMeal = useMemo(() => {
    if (!detail) return null;
    return {
      source: detail.source,
      data: detail.data,
      summary: toSummary(detail.data, detail.source),
    };
  }, [detail]);

  const ingredientList = useMemo(() => buildIngredientList(selectedMeal, servingTarget), [selectedMeal, servingTarget]);
  const instructionsText = useMemo(() => buildInstructionsText(selectedMeal), [selectedMeal]);
  const instructionBlocks = instructionsText.split('\n').filter(Boolean);
  const metadataChips = selectedMeal ? getMetadataChips(selectedMeal) : [];
  const summaryText = selectedMeal?.source === 'spoonacular' ? stripHtml(selectedMeal?.data?.summary || '') : '';
  const summaryBlocks = summaryText.split('\n').filter(Boolean);
  const hasMissingIngredients = Boolean(cardMeta?.missedIngredients?.length);
  const cookingGuide = COOKING_MODE_GUIDES[cookingMode];
  const nutritionNutrients = selectedMeal?.data?.nutrition?.nutrients ?? [];
  const keyNutrition = nutritionNutrients.filter((nutrient) =>
    ['Calories', 'Protein', 'Fat', 'Carbohydrates'].includes(nutrient.name),
  );

  useEffect(() => {
    setCompletedSteps(new Set());
  }, [instructionsText]);

  const handleToggleStep = (step) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  };

  const handleShareRecipe = async () => {
    if (!selectedMeal?.summary) return;
    const url = selectedMeal.summary.sourceUrl || window.location.href;
    const shareData = {
      title: selectedMeal.summary.title,
      text: 'Check out this recipe I found via MealMatch!',
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShareStatus('Shared successfully.');
      } else {
        await navigator.clipboard.writeText(url);
        setShareStatus('Link copied to clipboard.');
      }
    } catch (err) {
      console.error(err);
      setShareStatus('Unable to share right now.');
    }
  };

  const handleAddMissingToShoppingList = () => {
    if (!cardMeta?.missedIngredients?.length) return;
    const items = cardMeta.missedIngredients.map((ingredient) => ingredient.original || ingredient.originalName || ingredient.name);
    addShoppingItems(items);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <p>Loading recipe...</p>
      </div>
    );
  }

  if (error || !selectedMeal) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-3xl font-bold">Oops!</h1>
        <p>{error || 'Recipe not found.'}</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white"
        >
          Back to search
        </button>
      </div>
    );
  }

  const isFavorite = favoriteIds.has(buildFavoriteKey(selectedMeal.summary));

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 pb-20 text-white">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex items-center text-sm font-semibold text-teal-200 underline decoration-dotted"
        >
          ← Back to results
        </button>

        <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex-1">
              <p className="text-sm uppercase tracking-[0.3em] text-teal-300">Recipe Spotlight</p>
              <h1 className="mt-2 text-4xl font-bold text-white">{selectedMeal.summary.title}</h1>
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-white/80">
                {metadataChips.map((chip) => (
                  <span key={chip} className="rounded-full border border-white/20 px-3 py-1">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => toggleFavorite(selectedMeal.summary)}
                className={`inline-flex flex-1 items-center justify-center rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
                  isFavorite ? 'border-pink-400/60 text-pink-200 bg-pink-400/10' : 'border-white/20 text-white/80 hover:border-white/40'
                }`}
              >
                {isFavorite ? 'Saved' : 'Save Recipe'}
              </button>
              <button
                type="button"
                onClick={handleShareRecipe}
                className="inline-flex flex-1 items-center justify-center rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40"
              >
                Share
              </button>
            </div>
          </div>

          {selectedMeal.summary.image && (
            <img
              src={selectedMeal.summary.image}
              alt={selectedMeal.summary.title}
              className="mt-6 h-64 w-full rounded-3xl object-cover"
            />
          )}

          <div className="mt-6 space-y-4">
            {selectedMeal.source === 'spoonacular' && selectedMeal.data.servings && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-white/80">
                <label htmlFor="servings" className="font-semibold">Adjust servings:</label>
                <input
                  id="servings"
                  type="number"
                  min={1}
                  value={servingTarget || selectedMeal.data.servings}
                  onChange={(event) => setServingTarget(Number(event.target.value) || selectedMeal.data.servings)}
                  className="w-24 rounded-xl border border-white/20 bg-white/5 px-3 py-1 text-white focus:border-teal-300 focus:outline-none"
                />
                <span className="text-xs text-white/60">Ingredients update automatically</span>
              </div>
            )}

            {summaryBlocks.length > 0 && (
              <details className="rounded-2xl border border-white/10 bg-white/5 p-5" open>
                <summary className="cursor-pointer text-base font-semibold text-white">Summary</summary>
                <div className="mt-3 space-y-2 text-white/80">
                  {summaryBlocks.map((block, index) => (
                    <p key={`summary-${index}`}>{block}</p>
                  ))}
                </div>
              </details>
            )}

            <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 text-white/80 md:grid-cols-2">
              <div>
                <label htmlFor="cooking-mode" className="text-sm font-semibold text-white/80">
                  Cooking mode converter
                </label>
                <select
                  id="cooking-mode"
                  value={cookingMode}
                  onChange={(event) => setCookingMode(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/20 bg-slate-900/60 px-4 py-2 text-white focus:border-teal-300 focus:outline-none"
                >
                  {Object.entries(COOKING_MODE_GUIDES).map(([key, guide]) => (
                    <option key={key} value={key} className="bg-slate-900 text-white">
                      {guide.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="font-semibold text-teal-200">Temperature:</span> {cookingGuide.tempDelta}
                </p>
                <p>
                  <span className="font-semibold text-teal-200">Time:</span> {cookingGuide.timeDelta}
                </p>
                <p>
                  <span className="font-semibold text-teal-200">Notes:</span> {cookingGuide.notes}
                </p>
              </div>
            </div>

            <details className="rounded-2xl border border-white/10 bg-white/5 p-5" open>
              <summary className="cursor-pointer text-base font-semibold text-white">Instructions</summary>
              <div className="mt-3 space-y-2 text-white/80">
                {instructionBlocks.length ? (
                  instructionBlocks.map((block, index) => (
                    <p key={`instruction-${index}`}>{block}</p>
                  ))
                ) : (
                  <p>Instructions not available.</p>
                )}
              </div>
            </details>

            {hasMissingIngredients && (
              <button
                type="button"
                onClick={handleAddMissingToShoppingList}
                className="w-full rounded-2xl bg-teal-300/20 px-4 py-3 text-sm font-semibold text-teal-100 transition hover:bg-teal-300/30"
              >
                Add missing ingredients to shopping list
              </button>
            )}

            {shareStatus && <p className="text-sm text-white/70">{shareStatus}</p>}
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[2fr,1fr]">
          <article className="rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-xl">
            <h2 className="text-xl font-semibold text-white">Ingredients</h2>
            <ul className="mt-4 space-y-3 text-sm text-white">
              {ingredientList.length ? (
                ingredientList.map((item) => (
                  <li key={item} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-2">
                    {item}
                  </li>
                ))
              ) : (
                <li className="text-white/60">Ingredients not provided.</li>
              )}
            </ul>
          </article>
          <div className="space-y-6">
            <aside className="rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-xl">
              <h2 className="text-xl font-semibold text-white">Shopping List</h2>
              {shoppingList.length ? (
                <ul className="mt-4 space-y-3 text-sm text-white/90">
                  {shoppingList.map((item) => (
                    <li
                      key={item}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={() => removeShoppingItem(item)}
                        className="text-xs font-semibold text-teal-200 underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-white/70">No items saved yet.</p>
              )}
              {shoppingList.length > 0 && (
                <button
                  type="button"
                  onClick={clearShoppingList}
                  className="mt-4 w-full rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40"
                >
                  Clear list
                </button>
              )}
            </aside>
            <aside className="rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-xl">
              <h2 className="text-xl font-semibold text-white">Nutrition snapshot</h2>
              {keyNutrition.length ? (
                <ul className="mt-4 space-y-3 text-sm text-white/90">
                  {keyNutrition.map((nutrient) => (
                    <li
                      key={nutrient.name}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2"
                    >
                      <span>{nutrient.name}</span>
                      <span className="font-semibold text-teal-200">
                        {nutrient.amount}
                        {nutrient.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-white/70">Nutrition details not available for this recipe.</p>
              )}
            </aside>
          </div>
        </section>
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Step-by-step checklist</h2>
                <p className="text-sm text-white/70">Track your progress while you cook.</p>
              </div>
              {instructionBlocks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCompletedSteps(new Set())}
                  className="text-sm font-semibold text-teal-200 underline decoration-dotted"
                >
                  Reset steps
                </button>
              )}
            </div>
            {instructionBlocks.length ? (
              <ul className="mt-4 space-y-3">
                {instructionBlocks.map((block, index) => (
                  <li
                    key={`${index}-${block}`}
                    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
                      completedSteps.has(block)
                        ? 'border-teal-400/40 bg-teal-400/10 text-teal-50'
                        : 'border-white/10 bg-white/5 text-white/80'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={completedSteps.has(block)}
                      onChange={() => handleToggleStep(block)}
                      className="mt-1 size-4 accent-teal-400"
                    />
                    <span className={completedSteps.has(block) ? 'line-through opacity-80' : ''}>{block}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-white/70">Instructions not available.</p>
            )}
          </article>
          <aside className="rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-xl">
            <h2 className="text-xl font-semibold text-white">Ingredient swaps</h2>
            <p className="text-sm text-white/70">Common substitutions for flexibility.</p>
            <ul className="mt-4 space-y-3 text-sm text-white/80">
              {ingredientList
                .map((item) => {
                  const name = item.split('-')[0]?.trim().toLowerCase();
                  const subs = getIngredientSubstitutions(name);
                  if (!subs.length) return null;
                  return { name: item, subs };
                })
                .filter(Boolean)
                .slice(0, 5)
                .map((entry) => (
                  <li key={entry.name} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="font-semibold text-white">{entry.name}</p>
                    <p className="text-xs text-white/70">Try: {entry.subs.join(', ')}</p>
                  </li>
                ))}
            </ul>
          </aside>
        </section>

      </main>
    </div>
  );
};

export default RecipeDetail;
