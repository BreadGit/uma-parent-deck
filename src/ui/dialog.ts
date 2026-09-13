// Dialogs live outside the lit root, so writing their text directly is allowed.

let box: HTMLDialogElement | null = null;

function element(): HTMLDialogElement {
  const box = document.createElement('dialog');
  box.className = 'dialog';
  box.dataset.dialog = '';
  box.innerHTML = '<p data-dialog-message></p><div class="dialog-actions"><button type="button" data-dialog-cancel>Cancel</button><button type="button" class="primary" data-dialog-confirm>OK</button></div>';
  box.querySelector('[data-dialog-cancel]')!.addEventListener('click', () => box.close('cancel'));
  box.querySelector('[data-dialog-confirm]')!.addEventListener('click', () => box.close('ok'));
  document.body.append(box);
  return box;
}

function open(message: string, confirmLabel: string, cancel: boolean): Promise<boolean> {
  if (box) { box.close('cancel'); box.remove(); }
  const dialog = element();
  box = dialog;
  dialog.querySelector('[data-dialog-message]')!.textContent = message;
  dialog.querySelector('[data-dialog-confirm]')!.textContent = confirmLabel;
  dialog.querySelector<HTMLElement>('[data-dialog-cancel]')!.hidden = !cancel;
  return new Promise((resolve) => {
    // A queued close event belongs to this request even if another dialog has opened.
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
      if (box === dialog) box = null;
    }, { once: true });
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-confirm]')!.focus();
  });
}

/** Ask before a change that discards user input. Resolves true when confirmed. */
export const confirmDialog = (message: string, confirmLabel = 'OK') => open(message, confirmLabel, true);
/** Tell the user something went wrong. */
export const notice = (message: string) => open(message, 'OK', false).then(() => undefined);
