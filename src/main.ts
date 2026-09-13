import { mount } from './ui/app.ts';
import { loadSharedUrl } from './ui/share-prototype.ts';

mount(document.getElementById('app')!);
void loadSharedUrl();
