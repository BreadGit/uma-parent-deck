import { mount } from './ui/app.ts';
import { initializeSharing } from './ui/share.ts';

void initializeSharing().then(() => mount(document.getElementById('app')!));
