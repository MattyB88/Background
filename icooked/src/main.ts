import './ui/styles.css';
import * as THREE from 'three';
import { App } from './app';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const app = new App(canvas, ui);
(window as unknown as { icooked: App }).icooked = app;
(window as unknown as { THREEVector: typeof THREE.Vector3 }).THREEVector = THREE.Vector3;
