import { jsx as _jsx } from "react/jsx-runtime";
import { createRoot } from 'react-dom/client';
import './app.css';
import './index.css';
import App from './App';
createRoot(document.getElementById('root')).render(
//<StrictMode>
//  <App />
//</StrictMode>,
_jsx(App, {}));
