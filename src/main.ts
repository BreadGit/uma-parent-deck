const root = document.getElementById('app')!;
if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'white-sparks') {
  import('./prototypes/white-sparks.ts').then(({ mount }) => mount(root));
} else {
  import('./ui/app.ts').then(({ mount }) => mount(root));
}
