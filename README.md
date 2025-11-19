# MealMatch

MealMatch is a pantry-aware recipe finder that merges TheMealDB and Spoonacular catalogs, surfaces the recipes that best match the ingredients you already own, and enriches each result with USDA nutrition data. The project ships as a small Express backend plus a Vite + React SPA that keeps pantry items, favorites, and shopping lists in sync locally or through Supabase Auth.

## Highlights

- Search TheMealDB and Spoonacular simultaneously, then sort by best match, fewest missing ingredients, shortest prep time, and more.
- Pantry manager that can autofill your ingredient search, look up USDA nutrition facts for pantry items, and persist data locally or in Supabase.
- Diet/cuisine filters, random recipe discovery, ingredient auto-complete, and substitution suggestions for common staples.
- Recipe detail screen with scaled ingredient lists, cooking modes, share actions, favorites, and a shopping list fed by the ingredients you are missing.
- Optional OpenAI Sora integration that turns any recipe into a ready-to-run video prompt.

## Tech Stack

| Layer     | Tech                                                                                                    |
|-----------|---------------------------------------------------------------------------------------------------------|
| Frontend  | React 19, React Router, Vite, TailwindCSS, Supabase Auth, localStorage fallbacks                        |
| Backend   | Node.js (native fetch), Express 5, CORS, Dotenv, @supabase/supabase-js, OpenAI SDK                      |
| APIs      | TheMealDB, Spoonacular, USDA FoodData Central, OpenAI Sora (optional)                                   |

```
.
├── backend/    # Express proxy + aggregation layer
└── frontend/   # Vite + React SPA
```

## Requirements

- Node.js 20+ (backend relies on the native `fetch` implementation introduced in Node 18, Node 20 is recommended).
- npm 10+.
- Access tokens for Spoonacular, USDA/FDC, and optionally OpenAI Sora.
- (Optional) Supabase project for syncing favorites and pantry items across devices.

## Environment Variables

### `backend/.env`

```ini
PORT=4000
SPOONACULAR_API_KEY=your_spoonacular_key
USDA_API_KEY=your_usda_key   # or set FDC_API_KEY
OPENAI_API_KEY=sk-...        # optional, required for /api/video
```

### `frontend/.env`

```ini
VITE_API_BASE_URL=http://localhost:4000/api
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co          # optional but required for auth sync
VITE_SUPABASE_ANON_KEY=public-anon-key-from-supabase        # optional
```

If the Supabase variables are omitted the app silently falls back to storing favorites and pantry items in `localStorage`.

## Getting Started

1. **Install dependencies**
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. **Run the backend**
   ```bash
   cd backend
   npm run dev
   ```
   The Express server listens on `http://localhost:4000` and exposes all routes under `/api`.

3. **Run the frontend**
   ```bash
   cd frontend
   npm run dev -- --host
   ```
   Vite serves the SPA at `http://localhost:5173`. The app uses `HashRouter`, so it works even when deployed behind static hosting.

4. **Build for production**
   ```bash
   cd frontend
   npm run build
   npm run preview   # optional smoke test
   ```

## API Overview

| Method | Path                              | Description                                                                                  |
|--------|-----------------------------------|----------------------------------------------------------------------------------------------|
| GET    | `/api/recipes`                    | Search Spoonacular + TheMealDB by comma-separated ingredients, with optional diet filters.   |
| GET    | `/api/recipes/:id`                | Fetch a recipe detail from either provider.                                                  |
| GET    | `/api/cuisines`                   | List all cuisines available from TheMealDB.                                                  |
| GET    | `/api/recipes/area/:area`         | Filter TheMealDB results by area/cuisine.                                                    |
| GET    | `/api/random`                     | Pull one random recipe from the selected source(s).                                          |
| GET    | `/api/spoonacular/autocomplete`   | Proxy to Spoonacular’s recipe auto-complete endpoint.                                        |
| GET    | `/api/spoonacular/search`         | Proxy to the richer Spoonacular complex search API.                                          |
| GET    | `/api/usda/search`                | Fetch nutrition data for pantry items from USDA FoodData Central.                            |
| POST   | `/api/video`                      | Build (and optionally submit) an OpenAI Sora video prompt for the given recipe.              |

All responses surface source-specific errors so the UI can degrade gracefully if one API quota is exhausted.

## Supabase Setup (Optional, but recommended)

Create two tables in your Supabase project to sync favorites and pantry items. The definitions below assume `uuid_generate_v4()` is available; adjust to your project defaults.

```sql
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  recipe_id text not null,
  source text not null,
  title text not null,
  image text,
  source_url text,
  inserted_at timestamptz not null default now()
);
create index favorites_user_recipe_idx on public.favorites (user_id, recipe_id, source);

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  inserted_at timestamptz not null default now()
);
create index pantry_items_user_name_idx on public.pantry_items (user_id, lower(name));
```

Expose both tables to the Supabase anon key (Row Level Security policies that match the authenticated `user_id` are recommended).

## Troubleshooting

- **`500 Internal Server Error` when pushing to GitHub** – wait and retry; GitHub occasionally has regional hiccups. Once remote pushes succeed, `git push` will publish this repository to `aloniewski2/MealMatch`.
- **`Spoonacular API key is not configured`** – set `SPOONACULAR_API_KEY` in `backend/.env`.
- **Nothing happens when generating a video** – the backend returns a preview prompt if `OPENAI_API_KEY` is missing. Supply a key that has access to the `sora-2` model to receive real outputs.
- **Auth buttons disabled** – Supabase environment variables are required for sign-in; otherwise the UI operates in local-only mode.

You now have a ready-to-run README that documents how to install, configure, and extend MealMatch. PRs improving copy, tests, or data sources are welcome!
