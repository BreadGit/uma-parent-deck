import { html, nothing } from 'lit-html';
import { storageUnavailable } from '../state.ts';
import { COPY } from './copy.ts';

export const storageNotice = () => storageUnavailable
  ? html`<p class="banner" data-storage-warning role="status">${COPY.app.storageUnavailable}</p>`
  : nothing;
