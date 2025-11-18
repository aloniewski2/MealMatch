import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { buildFavoriteKey, normalizeFavorite } from '../utils/recipeUtils.js';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from './AuthContext.jsx';

const FAVORITES_KEY = 'mealMatchFavorites';
const SHOPPING_LIST_KEY = 'mealMatchShoppingList';

const MealMatchContext = createContext();

export const MealMatchProvider = ({ children }) => {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);

  const [shoppingList, setShoppingList] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = window.localStorage.getItem(SHOPPING_LIST_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.warn('Unable to read shopping list from localStorage', error);
      return [];
    }
  });

  useEffect(() => {
    const loadFavorites = async () => {
      if (!user) {
        if (typeof window === 'undefined') return;
        try {
          const stored = window.localStorage.getItem(FAVORITES_KEY);
          if (!stored) {
            setFavorites([]);
            return;
          }
          setFavorites(
            JSON.parse(stored)
              .map(normalizeFavorite)
              .filter(Boolean),
          );
        } catch (error) {
          console.warn('Unable to read favorites from localStorage', error);
          setFavorites([]);
        }
        return;
      }
      const { data, error } = await supabase
        .from('favorites')
        .select('id, recipe_id, title, image, source, source_url')
        .eq('user_id', user.id)
        .order('inserted_at', { ascending: false });
      if (error) {
        console.error('Unable to load favorites', error);
        setFavorites([]);
        return;
      }
      setFavorites(
        (data ?? []).map((row) => ({
          id: row.recipe_id,
          title: row.title,
          image: row.image,
          source: row.source,
          sourceUrl: row.source_url || '',
          _supabaseId: row.id,
        })),
      );
    };
    loadFavorites();
  }, [user]);

  useEffect(() => {
    if (!user && typeof window !== 'undefined') {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }
  }, [favorites, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SHOPPING_LIST_KEY, JSON.stringify(shoppingList));
  }, [shoppingList]);

  const favoriteIds = useMemo(
    () => new Set(favorites.map((favorite) => buildFavoriteKey(favorite))),
    [favorites],
  );

  const toggleFavorite = async (summary) => {
    const normalized = normalizeFavorite(summary);
    if (!normalized) return;
    const key = buildFavoriteKey(normalized);
    if (!user) {
      setFavorites((prev) => {
        if (prev.some((favorite) => buildFavoriteKey(favorite) === key)) {
          return prev.filter((favorite) => buildFavoriteKey(favorite) !== key);
        }
        return [...prev, normalized];
      });
      return;
    }
    const existing = favorites.find((favorite) => buildFavoriteKey(favorite) === key);
    if (existing && existing._supabaseId) {
      const { error } = await supabase.from('favorites').delete().eq('id', existing._supabaseId);
      if (error) {
        console.error('Unable to remove favorite', error);
      }
    } else {
      const { error } = await supabase.from('favorites').insert({
        user_id: user.id,
        recipe_id: normalized.id,
        source: normalized.source,
        title: normalized.title,
        image: normalized.image,
        source_url: normalized.sourceUrl || '',
      });
      if (error) {
        console.error('Unable to save favorite', error);
      }
    }
    const { data } = await supabase
      .from('favorites')
      .select('id, recipe_id, title, image, source, source_url')
      .eq('user_id', user.id)
      .order('inserted_at', { ascending: false });
    setFavorites(
      (data ?? []).map((row) => ({
        id: row.recipe_id,
        title: row.title,
        image: row.image,
        source: row.source,
        sourceUrl: row.source_url || '',
        _supabaseId: row.id,
      })),
    );
  };

  const addShoppingItems = (items) => {
    setShoppingList((prev) => {
      const uniqueItems = new Set(prev);
      items.forEach((item) => item && uniqueItems.add(item));
      return Array.from(uniqueItems);
    });
  };

  const removeShoppingItem = (item) => {
    setShoppingList((prev) => prev.filter((entry) => entry !== item));
  };

  const clearShoppingList = () => setShoppingList([]);

  const value = {
    favorites,
    favoriteIds,
    toggleFavorite,
    shoppingList,
    addShoppingItems,
    removeShoppingItem,
    clearShoppingList,
    buildFavoriteKey,
  };

  return <MealMatchContext.Provider value={value}>{children}</MealMatchContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useMealMatch = () => useContext(MealMatchContext);
