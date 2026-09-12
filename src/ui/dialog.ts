// One <dialog> for confirmations and notices. It lives outside the lit root, so writing its text directly is allowed.

let box: HTMLDialogElement | null = null;
let settle: ((ok: boolean) => void) | null = null;

function element(): HTMLDialogElement {
  if (box) return box;
  box = document.createElement('dialog');
  box.className = 'dialog';
  box.dataset.dialog = '';
  box.innerHTML = '<p data-dialog-message></p><div class="dialog-actions"><button type="button" data-dialog-cancel>Cancel</button><button type="button" class="primary" data-dialog-confirm>OK</button></div>';
  box.querySelector('[data-dialog-cancel]')!.addEventListener('click', () => box!.close('cancel'));
  box.querySelector('[data-dialog-confirm]')!.addEventListener('click', () => box!.close('ok'));
  box.addEventListener('close', () => { settle?.(box!.returnValue === 'ok'); settle = null; });
  document.body.append(box);
  return box;
}

function open(message: string, confirmLabel: string, cancel: boolean): Promise<boolean> {
  const dialog = element();
  if (dialog.open) dialog.close('cancel');
  dialog.querySelector('[data-dialog-message]')!.textContent = message;
  dialog.querySelector('[data-dialog-confirm]')!.textContent = confirmLabel;
  dialog.querySelector<HTMLElement>('[data-dialog-cancel]')!.hidden = !cancel;
  dialog.returnValue = '';
  return new Promise((resolve) => { settle = resolve; dialog.showModal(); dialog.querySelector<HTMLElement>('[data-dialog-confirm]')!.focus(); });
}

/** Ask before a change that discards user input. Resolves true when confirmed. */
export const confirmDialog = (message: string, confirmLabel = 'OK') => open(message, confirmLabel, true);
/** Tell the user something went wrong. */
export const notice = (message: string) => open(message, 'OK', false).then(() => undefined);
