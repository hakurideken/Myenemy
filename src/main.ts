import './styles/main.css';
import { InMemoryHub, type InMemoryTransport } from './net/InMemoryTransport';
import { roomFromSearch } from './net/room';
import { App } from './ui/App';
import { h } from './ui/dom';

const root = document.getElementById('app');
if (!root) throw new Error('Chybí kořenový element #app');

const params = new URLSearchParams(window.location.search);

if (import.meta.env.DEV && params.has('duo')) {
  // Vývoj: dva hráči vedle sebe v jedné záložce, spojení přes InMemoryTransport (bez internetu).
  const hub = new InMemoryHub({ latencyMs: 40, jitterMs: 30 });
  const transports: InMemoryTransport[] = [];
  const transport = (): Promise<InMemoryTransport> => {
    const t = hub.createTransport();
    transports.push(t);
    return Promise.resolve(t);
  };
  // Pro ruční testy výpadku z konzole: __duo.transports[1].setConnected(false)
  Object.assign(window, { __duo: { hub, transports } });
  const left = h('div', { class: 'duo-pane', 'aria-label': 'Hráč 1' });
  const right = h('div', { class: 'duo-pane', 'aria-label': 'Hráč 2' });
  root.classList.add('duo');
  root.append(left, right);
  new App(left, { transport, nickname: 'Hostitel' }).boot();
  new App(right, { transport, nickname: 'Soupeř', suggestRoom: () => hub.lastRoom }).boot();
} else {
  const pendingRoom = roomFromSearch(window.location.search);
  if (params.has('room')) {
    // Kód si zapamatujeme a z adresy ho odstraníme, ať obnovení stránky nepřipojuje znovu.
    params.delete('room');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }
  new App(root, { pendingRoom }).boot();
}
