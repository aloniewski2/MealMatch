import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  API_BASE_URL,
  PANTRY_KEY,
  buildCardsFromPayload,
  buildFavoriteKey,
  sanitizeIngredients,
} from '../utils/recipeUtils.js';
import { useMealMatch } from '../context/MealMatchContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import '../index.css';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'missing', label: 'Fewest missing ingredients' },
  { value: 'used', label: 'Most ingredients you have' },
  { value: 'match', label: 'Highest match score' },
  { value: 'prep', label: 'Shortest prep time' },
];

const COMMON_SPICES = [
  'salt',
  'pepper',
  'garlic powder',
  'onion powder',
  'paprika',
  'cumin',
  'curry powder',
  'basil',
  'oregano',
  'thyme',
  'chili powder',
  'ginger',
];

const DIET_OPTIONS = ['Vegetarian', 'Vegan', 'Gluten Free', 'Ketogenic', 'Pescetarian', 'Paleo'];

const renderIngredientBadges = (label, items, variant) => {
  if (!items?.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((ingredient, index) => (
          <span
            key={`${label}-${ingredient.id || ingredient.name || ingredient.original || index}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${variant}`}
          >
            {ingredient.original || ingredient.originalName || ingredient.name}
          </span>
        ))}
      </div>
    </div>
  );
};

const Home = () => {
  const navigate = useNavigate();
  const { favorites, favoriteIds, toggleFavorite, shoppingList, removeShoppingItem, clearShoppingList } =
    useMealMatch();
  const { user, authLoading, authError, signIn, signUp, signOut, setAuthError } = useAuth();
  const [ingredients, setIngredients] = useState('');
  const [selectedCuisine, setSelectedCuisine] = useState('');
  const [sourceSelection] = useState('both');
  const [dietFilter, setDietFilter] = useState('');
  const [sortOption, setSortOption] = useState('relevance');
  const [cuisines, setCuisines] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [randomLoading, setRandomLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [ignoreSpices, setIgnoreSpices] = useState(true);
  const [pantryItems, setPantryItems] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = window.localStorage.getItem(PANTRY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.warn('Unable to read pantry from localStorage', error);
      return [];
    }
  });
  const [newPantryItem, setNewPantryItem] = useState('');
  const [pantryNutrition, setPantryNutrition] = useState(null);
  const [pantryNutritionLoading, setPantryNutritionLoading] = useState(false);
  const [pantryNutritionError, setPantryNutritionError] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const fetchJson = useCallback(async (path, options) => {
    const response = await fetch(`${API_BASE_URL}${path}`, options);
    if (!response.ok) {
      throw new Error('Unable to reach MealMatch backend');
    }
    const data = await response.json();
    if (data?.error) {
      throw new Error(data.error);
    }
    return data;
  }, []);

  useEffect(() => {
    const loadCuisines = async () => {
      try {
        const data = await fetchJson('/cuisines');
        const areas = data?.meals
          ?.map((item) => item.strArea)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setCuisines(areas ?? []);
      } catch (err) {
        console.warn('Could not load cuisines', err);
      }
    };

    loadCuisines();
  }, [fetchJson]);

  useEffect(() => {
    const loadPantry = async () => {
      if (!user) {
        if (typeof window === 'undefined') return;
        try {
          const stored = window.localStorage.getItem(PANTRY_KEY);
          setPantryItems(stored ? JSON.parse(stored) : []);
        } catch (error) {
          console.warn('Unable to read pantry from localStorage', error);
          setPantryItems([]);
        }
        return;
      }
      const { data, error } = await supabase
        .from('pantry_items')
        .select('name')
        .eq('user_id', user.id)
        .order('inserted_at');
      if (error) {
        console.error('Unable to load pantry items', error);
        setPantryItems([]);
        return;
      }
      setPantryItems((data ?? []).map((row) => row.name));
    };
    loadPantry();
  }, [user]);

  useEffect(() => {
    if (!user && typeof window !== 'undefined') {
      window.localStorage.setItem(PANTRY_KEY, JSON.stringify(pantryItems));
    }
  }, [pantryItems, user]);

  const applyCuisineFilter = async (cards) => {
    if (!selectedCuisine) return cards;
    try {
      const areaData = await fetchJson(`/recipes/area/${encodeURIComponent(selectedCuisine)}`);
      const allowedIds = new Set((areaData?.meals ?? []).map((meal) => meal.idMeal));
      return cards.filter((card) => (card.source === 'spoonacular' ? true : allowedIds.has(card.id)));
    } catch (err) {
      console.warn('Unable to filter by cuisine', err);
      return cards;
    }
  };

  const sortCards = useCallback(
    (cards) => {
      if (sortOption === 'relevance') return cards;
      const copy = [...cards];
      const ignored = new Set(ignoreSpices ? COMMON_SPICES.map((spice) => normalizeIngredientName(spice)) : []);
      if (sortOption === 'missing') {
        return copy.sort((a, b) => {
          const aMissed = (a.missedIngredients ?? []).filter(
            (ingredient) => !ignored.has(normalizeIngredientName(ingredient.name || ingredient.original || '')),
          ).length;
          const bMissed = (b.missedIngredients ?? []).filter(
            (ingredient) => !ignored.has(normalizeIngredientName(ingredient.name || ingredient.original || '')),
          ).length;
          return aMissed - bMissed;
        });
      }
      if (sortOption === 'used') {
        return copy.sort(
          (a, b) =>
            (b.usedIngredients ?? []).filter(
              (ingredient) => !ignored.has(normalizeIngredientName(ingredient.name || ingredient.original || '')),
            ).length -
            (a.usedIngredients ?? []).filter(
              (ingredient) => !ignored.has(normalizeIngredientName(ingredient.name || ingredient.original || '')),
            ).length,
        );
      }
      if (sortOption === 'match') {
        return copy.sort((a, b) => getMatchScore(b, ignored) - getMatchScore(a, ignored));
      }
      if (sortOption === 'prep') {
        return copy.sort(
          (a, b) =>
            (a.readyInMinutes ?? Number.MAX_SAFE_INTEGER) - (b.readyInMinutes ?? Number.MAX_SAFE_INTEGER),
        );
      }
      return copy;
    },
    [sortOption, ignoreSpices],
  );

  useEffect(() => {
    setRecipes((prev) => sortCards(prev));
  }, [sortCards]);

  const handleSearch = async (event) => {
    event?.preventDefault();
    const normalized = sanitizeIngredients(ingredients);

    if (!normalized) {
      setError('Please enter at least one ingredient.');
      setInfoMessage('');
      setRecipes([]);
      return;
    }

    setLoading(true);
    setError('');
    setInfoMessage('');

    try {
      const params = new URLSearchParams({
        ingredients: normalized,
        source: sourceSelection,
      });
      if (dietFilter) {
        params.set('diet', dietFilter.toLowerCase());
      }
      const result = await fetchJson(`/recipes?${params.toString()}`);
      const filtered = await applyCuisineFilter(buildCardsFromPayload(result));
      const sortedCards = sortCards(filtered);

      if (!sortedCards.length) {
        setRecipes([]);
        setInfoMessage('No recipes found. Try different ingredients, another cuisine, or toggle data sources.');
        return;
      }

      setRecipes(sortedCards);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Something went wrong. Make sure your Spoonacular key is configured for premium filters.');
    } finally {
      setLoading(false);
    }
  };

  const handleRandomRecipe = async () => {
    setRandomLoading(true);
    setError('');
    setInfoMessage('');

    try {
      const params = new URLSearchParams({ source: sourceSelection });
      if (dietFilter && (sourceSelection === 'spoonacular' || sourceSelection === 'both')) {
        params.set('diet', dietFilter.toLowerCase());
      }
      const randomData = await fetchJson(`/random?${params.toString()}`);
      const cards = buildCardsFromPayload(randomData);

      if (!cards.length) {
        setInfoMessage('Could not load a random recipe. Please try again.');
        setRecipes([]);
        return;
      }

      const sortedCards = sortCards(cards);
      setRecipes(sortedCards);
      setIngredients('');
      setSelectedCuisine('');
    } catch (err) {
      console.error(err);
      setError('Unable to fetch a random recipe.');
    } finally {
      setRandomLoading(false);
    }
  };

  const refreshPantryFromSupabase = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('pantry_items')
      .select('name')
      .eq('user_id', user.id)
      .order('inserted_at');
    if (error) {
      console.error('Unable to load pantry items', error);
      return;
    }
    setPantryItems((data ?? []).map((row) => row.name));
  }, [user]);

  const handleAddPantryItem = async () => {
    const cleaned = sanitizeIngredients(newPantryItem);
    if (!cleaned) return;
    const tokens = cleaned.split(',');
    if (user) {
      await Promise.all(
        tokens.map(async (token) => {
          if (!token) return;
          const { error } = await supabase.from('pantry_items').insert({
            user_id: user.id,
            name: token,
          });
          if (error && !error.message.includes('duplicate')) {
            console.error('Unable to save pantry item', error);
          }
        }),
      );
      await refreshPantryFromSupabase();
      setNewPantryItem('');
      return;
    }
    setPantryItems((prev) => {
      const next = [...prev];
      tokens.forEach((token) => {
        if (token && !next.includes(token)) {
          next.push(token);
        }
      });
      return next;
    });
    setNewPantryItem('');
  };

  const handleRemovePantryItem = async (item) => {
    if (user) {
      const { error } = await supabase
        .from('pantry_items')
        .delete()
        .eq('user_id', user.id)
        .eq('name', item);
      if (error) {
        console.error('Unable to remove pantry item', error);
      }
      await refreshPantryFromSupabase();
      return;
    }
    setPantryItems((prev) => prev.filter((entry) => entry !== item));
  };

  const handleFillFromPantry = () => {
    if (!pantryItems.length) return;
    setIngredients(pantryItems.join(', '));
  };

  const handleViewPantryNutrition = async (item) => {
    setPantryNutritionLoading(true);
    setPantryNutritionError('');
    setPantryNutrition(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/usda/search?query=${encodeURIComponent(item)}`,
      );
      if (!response.ok) {
        throw new Error('Unable to fetch nutrition info');
      }
      const data = await response.json();
      const food = data?.foods?.[0];
      if (!food) {
        setPantryNutritionError('No USDA nutrition data found for this ingredient.');
        setPantryNutrition(null);
        return;
      }
      const nutrients = (food.foodNutrients ?? []).filter((nutrient) =>
        ['Energy', 'Protein', 'Total lipid (fat)', 'Carbohydrate, by difference'].includes(nutrient.nutrientName),
      );
      setPantryNutrition({
        name: food.description,
        source: food.brandOwner || 'USDA FoodData Central',
        nutrients: nutrients.map((nutrient) => ({
          name: nutrient.nutrientName,
          unit: nutrient.unitName,
          amount: nutrient.value,
        })),
      });
    } catch (err) {
      console.error(err);
      setPantryNutritionError(err.message || 'Unable to fetch nutrition info');
    } finally {
      setPantryNutritionLoading(false);
    }
  };

  const handleOpenRecipe = (card) => {
    navigate(`/recipe/${card.source}/${card.id}`, { state: { card } });
  };

  const handleAuthAction = async (mode) => {
    if (!authEmail || !authPassword) return;
    setAuthSubmitting(true);
    try {
      if (mode === 'signin') {
        await signIn(authEmail, authPassword);
      } else {
        await signUp(authEmail, authPassword);
      }
      setAuthEmail('');
      setAuthPassword('');
      setAuthError('');
    } catch (error) {
      console.error('Authentication error', error);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const renderRecipes = () => {
    if (!recipes.length) return null;

    return (
      <section className="mt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-white">Matching Recipes</h2>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-wrap gap-3">
              <select
                value={sortOption}
                onChange={(event) => setSortOption(event.target.value)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:border-teal-300 focus:outline-none"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={ignoreSpices}
                  onChange={(event) => setIgnoreSpices(event.target.checked)}
                  className="size-4 accent-teal-400"
                />
                Ignore common spices
              </label>
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {recipes.map((card) => (
            <Link
              key={`${card.source}-${card.id}`}
              to={`/recipe/${card.source}/${card.id}`}
              state={{ card }}
              className="group block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              <article className="cursor-pointer bg-slate-900/80 border border-white/10 rounded-2xl overflow-hidden shadow-lg flex flex-col transition group-hover:border-teal-300/40">
                <img src={card.image} alt={card.title} className="h-48 w-full object-cover" loading="lazy" />
                <div className="flex flex-1 flex-col p-5 gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-white">{card.title}</h3>
                </div>
                  {card.source === 'spoonacular' && (
                    <div className="space-y-3 text-white/80">
                      <div className={`text-xs font-semibold ${getMatchColor(getMatchScore(card))}`}>
                        Match score: {getMatchScore(card)}%
                      </div>
                      {renderIngredientBadges(
                        'Used',
                        card.usedIngredients,
                      'bg-emerald-400/15 text-emerald-50 border border-emerald-300/30',
                    )}
                    {renderIngredientBadges(
                      'Missing',
                      card.missedIngredients,
                      'bg-amber-400/15 text-amber-50 border border-amber-300/30',
                    )}
                    {renderIngredientBadges(
                      'Unused',
                      card.unusedIngredients,
                      'bg-slate-100/10 text-slate-50 border border-white/10',
                    )}
                  </div>
                )}
                <div className="mt-auto flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleFavorite(card);
                    }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                      favoriteIds.has(buildFavoriteKey(card))
                        ? 'border-pink-400/60 text-pink-200 bg-pink-400/10'
                        : 'border-white/20 text-white/80 hover:border-white/40'
                    }`}
                  >
                    <span>{favoriteIds.has(buildFavoriteKey(card)) ? 'Saved' : 'Save'}</span>
                  </button>
                  <span className="flex items-center rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70">
                    {card.readyInMinutes ? `${card.readyInMinutes} min` : `${card.usedIngredients.length || '-'} used`}
                  </span>
                </div>
              </div>
            </article>
          </Link>
          ))}
        </div>
      </section>
    );
  };

  const renderShoppingList = () => {
    if (!shoppingList.length) return null;
    return (
      <section className="mt-14 rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Shopping List</h2>
            <p className="text-sm text-white/70">Missing ingredients saved from your recipes.</p>
          </div>
          <button
            type="button"
            onClick={clearShoppingList}
            className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40"
          >
            Clear list
          </button>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {shoppingList.map((item) => (
            <li
              key={item}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-white/90"
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
      </section>
    );
  };

  const renderFavorites = () => {
    if (!favorites.length) return null;

    return (
      <section className="mt-14">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Favorite Recipes</h2>
          <p className="text-sm text-white/70">Saved locally on this device</p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {favorites.map((favorite) => (
            <article
              key={buildFavoriteKey(favorite)}
              className="rounded-2xl border border-white/5 bg-slate-900/70 p-4 shadow-lg"
            >
              <div className="flex items-center gap-4">
                <img src={favorite.image} alt={favorite.title} className="h-16 w-16 rounded-xl object-cover" />
                <div>
                  <h3 className="text-sm font-semibold text-white">{favorite.title}</h3>
                  <span className="mt-1 inline-flex rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                    {favorite.source === 'spoonacular' ? 'Spoonacular' : 'TheMealDB'}
                  </span>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenRecipe(favorite)}
                      className="rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white/90"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(favorite)}
                      className="rounded-lg bg-pink-500/10 px-3 py-1 text-xs font-semibold text-pink-100"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 pb-20 text-white">
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.4em] text-teal-200">MealMatch</p>
          <h1 className="mt-4 text-4xl font-bold text-white sm:text-5xl">
            Find recipes that match your fridge.
          </h1>
          <p className="mt-3 text-lg text-white/70">
            Combine Spoonacular's flexible ingredient matching with TheMealDB's curated catalog for the best coverage.
          </p>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5 text-white">
            {user ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Signed in</p>
                  <p className="text-xs text-white/70">{user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleAuthAction('signin');
                }}
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder="Email"
                    className="flex-1 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-teal-300 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    placeholder="Password"
                    className="flex-1 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-teal-300 focus:outline-none"
                  />
                </div>
                {authError && <p className="text-xs text-red-300">{authError}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleAuthAction('signin')}
                    className="rounded-2xl bg-teal-400/90 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-300"
                    disabled={authSubmitting || authLoading}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAuthAction('signup')}
                    className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40"
                    disabled={authSubmitting || authLoading}
                  >
                    Sign up
                  </button>
                </div>
              </form>
            )}
          </div>

          <form className="mt-8 flex flex-col gap-6" onSubmit={handleSearch}>
            <div className="space-y-3">
              <label className="text-sm font-semibold text-white/80" htmlFor="ingredients">
                Ingredients (comma separated)
              </label>
              <input
                id="ingredients"
                type="text"
                value={ingredients}
                onChange={(event) => setIngredients(event.target.value)}
                onBlur={() => setIngredients(sanitizeIngredients(ingredients))}
                placeholder="e.g., potato, bacon"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/40 focus:border-teal-300 focus:outline-none"
              />
              <p className="text-xs text-white/60">Trailing commas and spaces are trimmed automatically.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-white/80" htmlFor="cuisine">
                  Filter by cuisine (TheMealDB only)
                </label>
                <select
                  id="cuisine"
                  value={selectedCuisine}
                  onChange={(event) => setSelectedCuisine(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white focus:border-teal-300 focus:outline-none"
                >
                  <option value="">All cuisines</option>
                  {cuisines.map((cuisine) => (
                    <option key={cuisine} value={cuisine} className="bg-slate-900 text-white">
                      {cuisine}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold text-white/80" htmlFor="diet">
                  Diet preference (Spoonacular)
                </label>
                <select
                  id="diet"
                  value={dietFilter}
                  onChange={(event) => setDietFilter(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white focus:border-teal-300 focus:outline-none"
                >
                  <option value="">No preference</option>
                  {DIET_OPTIONS.map((diet) => (
                    <option key={diet} value={diet.toLowerCase()} className="bg-slate-900 text-white">
                      {diet}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-white/80">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white/80">Pantry manager</p>
                    <p className="text-xs text-white/60">Save staples and auto-fill ingredients.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleFillFromPantry}
                    className="rounded-2xl border border-white/20 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/40"
                    disabled={!pantryItems.length}
                  >
                    Use pantry items
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-2 lg:flex-row">
                  <input
                    type="text"
                    value={newPantryItem}
                    onChange={(event) => setNewPantryItem(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleAddPantryItem();
                      }
                    }}
                    placeholder="e.g., olive oil, sugar"
                    className="flex-1 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-teal-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddPantryItem}
                    className="rounded-2xl bg-teal-400/80 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-300"
                  >
                    Add item
                  </button>
                </div>
                {pantryItems.length ? (
                  <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                    {pantryItems.map((item) => (
                      <li
                        key={item}
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-white/80"
                      >
                        {item}
                        <button
                          type="button"
                          onClick={() => handleViewPantryNutrition(item)}
                          className="text-xs font-semibold text-amber-200 underline"
                        >
                          info
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemovePantryItem(item)}
                          className="text-xs font-semibold text-teal-200"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-white/60">No items saved yet.</p>
                )}
                {(pantryNutrition || pantryNutritionLoading || pantryNutritionError) && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-white/80">
                    <p className="text-sm font-semibold text-white">USDA Nutrition info</p>
                    {pantryNutritionLoading && <p className="text-xs text-white/60 mt-2">Loading...</p>}
                    {pantryNutritionError && (
                      <p className="mt-2 text-xs text-red-300">{pantryNutritionError}</p>
                    )}
                    {pantryNutrition && (
                      <>
                        <p className="mt-2 text-base text-white">{pantryNutrition.name}</p>
                        <ul className="mt-2 space-y-1">
                          {pantryNutrition.nutrients.map((nutrient) => (
                            <li key={nutrient.name} className="flex justify-between">
                              <span>{nutrient.name}</span>
                              <span className="font-semibold text-teal-200">
                                {nutrient.amount} {nutrient.unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-teal-400/90 px-5 py-3 text-base font-semibold text-slate-950 transition hover:bg-teal-300"
                  disabled={loading}
                >
                  {loading ? 'Searching...' : 'Find Recipes'}
                </button>
                <button
                  type="button"
                  onClick={handleRandomRecipe}
                  className="flex-1 rounded-2xl border border-white/20 px-5 py-3 text-base font-semibold text-white transition hover:border-white/50"
                  disabled={randomLoading}
                >
                  {randomLoading ? 'Loading...' : 'Random recipe'}
                </button>
              </div>
            </div>
          </form>
        </section>

        {error && (
          <p className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
            {error}
          </p>
        )}
        {infoMessage && (
          <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white/80">
            {infoMessage}
          </p>
        )}

        {renderRecipes()}
        {renderShoppingList()}
        {renderFavorites()}
      </main>
    </div>
  );
};

export default Home;
const normalizeIngredientName = (name = '') =>
  name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const getMatchScore = (card, ignored = new Set()) => {
  const used = (card.usedIngredients ?? []).filter(
    (ingredient) => !ignored.has(normalizeIngredientName(ingredient.name || ingredient.original || '')),
  ).length;
  const missed = (card.missedIngredients ?? []).filter(
    (ingredient) => !ignored.has(normalizeIngredientName(ingredient.name || ingredient.original || '')),
  ).length;
  const total = used + missed;
  if (total === 0) return 0;
  return Math.round((used / total) * 100);
};

const getMatchColor = (score) => {
  if (score >= 70) return 'text-emerald-300';
  if (score >= 40) return 'text-amber-300';
  return 'text-red-300';
};
