import './App.css'
import { Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Login from './components/Login'
import Register from './components/Register'
import MainLobby from './components/MainLobby'
import Connect4Game from './components/Connect4Game'

interface User {
  id: string;
  username: string;
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // check if user is logged in on app load
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        setCurrentUser(user);
      } catch (e) {
        console.error('Failed to parse user data');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const handleLogin = (user: User, token: string) => {
    setCurrentUser(user);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" />} />
      <Route 
        path="/login" 
        element={
          currentUser ? 
            <Navigate to="/lobby" /> : 
            <Login onLogin={handleLogin} />
        } 
      />
      <Route 
        path="/register" 
        element={
          currentUser ? 
            <Navigate to="/lobby" /> : 
            <Register />
        } 
      />
      <Route
        path="/lobby"
        element={
          currentUser ? 
            <MainLobby currentUser={currentUser} onLogout={handleLogout} /> : 
            <Navigate to="/login" />
        }
      />
      <Route
        path="/game/:gameId"
        element={
          currentUser ? 
            <Connect4Game currentUser={currentUser} /> : 
            <Navigate to="/login" />
        }
      />
    </Routes>
  )
}

export default App