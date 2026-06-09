import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Scene from './Scene.jsx';
import RockReveal from './RockReveal.jsx';
import NewWay from './NewWay.jsx';
import Reveal from './Reveal.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Scene />} />
        <Route path="/rockreveal" element={<RockReveal />} />
        <Route path="/newway" element={<NewWay />} />
        <Route path="/reveal" element={<Reveal />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
