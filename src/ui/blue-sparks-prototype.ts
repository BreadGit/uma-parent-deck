/// <reference types="vite/client" />
// Temporary design-review view for the archived Parent blue sparks prototype B.
import { html, num, type Raw } from './html.ts';
import './blue-sparks-prototype.css';

export interface BlueSparkPrototypeStat {
  name: string;
  parentStars: [number, number];
  start: number;
  inspiration: number;
  total: number;
}

export function showBlueSparksPrototypeB(): boolean {
  return import.meta.env.DEV && new URLSearchParams(location.search).get('variant')?.toUpperCase() === 'B';
}

function statHref(stat: number): string {
  const url = new URL(location.href);
  url.searchParams.set('variant', 'B');
  url.searchParams.set('stat', String(stat));
  return `${url.pathname}${url.search}`;
}

function slider(stat: BlueSparkPrototypeStat, statIndex: number, parentIndex: number, maxStars: number): Raw {
  return html`<input class="blue-prototype-slider" type="range" min="0" max="${maxStars}" step="1" value="${stat.parentStars[parentIndex]}" data-prototype-parent="${parentIndex}" data-prototype-stat="${statIndex}" aria-label="Parent ${parentIndex + 1} ${stat.name} blue stars" />`;
}

function gain(stat: BlueSparkPrototypeStat): Raw {
  return html`<div class="blue-prototype-gain">
    <strong>Total gain <output data-prototype-total>+${num(stat.total)}</output></strong>
    <span><output data-prototype-start>+${num(stat.start)}</output> at start · <output data-prototype-inspiration>+${num(stat.inspiration)}</output> from inspiration events</span>
  </div>`;
}

export function renderBlueSparksPrototypeB(stats: BlueSparkPrototypeStat[], maxStars: number): Raw {
  const requested = Number(new URLSearchParams(location.search).get('stat') ?? 0);
  const activeIndex = Math.max(0, Math.min(stats.length - 1, Number.isFinite(requested) ? requested : 0));
  const active = stats[activeIndex]!;
  return html`<div class="blue-prototype blue-prototype-b">
    <nav class="blue-prototype-tabs" aria-label="Stat to edit">${stats.map((stat, index) => html`<a class="${index === activeIndex ? 'active' : ''}" href="${statHref(index)}">${stat.name}</a>`)}</nav>
    <section class="blue-prototype-focus" data-prototype-stat-group="${activeIndex}">
      <div class="blue-prototype-heading"><strong>${active.name}</strong><output data-prototype-combined>${active.parentStars[0] + active.parentStars[1]}★ combined</output></div>
      ${[0, 1].map((parentIndex) => html`<label class="blue-prototype-parent"><span>Parent ${parentIndex + 1} <output data-prototype-stars="${parentIndex}">${active.parentStars[parentIndex]}★</output></span>${slider(active, activeIndex, parentIndex, maxStars)}</label>`)}
      ${gain(active)}
    </section>
    <div class="blue-prototype-summary">${stats.map((stat) => html`<span>${stat.name} <strong>+${num(stat.total)}</strong></span>`)}</div>
  </div>`;
}
