import './styles/main.css';
import { App } from './ui/App';

const root = document.getElementById('app');
if (!root) throw new Error('Chybí kořenový element #app');
new App(root).boot();
