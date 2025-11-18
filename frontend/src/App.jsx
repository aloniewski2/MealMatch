import { HashRouter, Route, Routes } from 'react-router-dom';
import { MealMatchProvider } from './context/MealMatchContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import Home from './pages/Home.jsx';
import RecipeDetail from './pages/RecipeDetail.jsx';

function App() {
  return (
    <AuthProvider>
      <MealMatchProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/recipe/:source/:id" element={<RecipeDetail />} />
          </Routes>
        </HashRouter>
      </MealMatchProvider>
    </AuthProvider>
  );
}

export default App;
