import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// If anything in the app crashes while drawing the screen, show a way back
// instead of a blank white page.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('WoRxshift crashed', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="signin-wrap">
        <div className="signin">
          <h1>Something went wrong</h1>
          <p>WoRxshift hit an unexpected problem. Reloading usually fixes it.</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
