import { render } from 'preact';
import './style.css';
import { App } from './app';
import { CapturePage } from './panels/capture';

const root = document.getElementById('app')!;
// The bookmarklet opens /#capture; everything else is the test dashboard.
render(location.hash === '#capture' ? <CapturePage /> : <App />, root);
