import './ui/styles.css';
import { App } from './app';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const app = new App(canvas, ui);
(window as unknown as { icooked: App }).icooked = app;
