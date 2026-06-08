import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import RockReveal from './RockReveal.jsx';
import ShadowTest from './ShadowTest.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RockReveal />} />
        <Route path="/shadowtest" element={<ShadowTest />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
