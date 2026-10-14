// Dialogs live outside the lit root, so writing their text directly is allowed.

let current: HTMLDialogElement | null = null;

function createDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  dialog.dataset.dialog = '';
  dialog.innerHTML = '<p data-dialog-message></p><div class="dialog-actions"><button type="button" data-dialog-cancel>Cancel</button><button type="button" class="primary" data-dialog-confirm>OK</button></div>';
  dialog.querySelector('[data-dialog-cancel]')!.addEventListener('click', () => dialog.close('cancel'));
  dialog.querySelector('[data-dialog-confirm]')!.addEventListener('click', () => dialog.close('ok'));
  document.body.append(dialog);
  return dialog;
}

function open(message: string, confirmLabel: string, cancel: boolean): Promise<boolean> {
  if (current) { current.close('cancel'); current.remove(); }
  const dialog = createDialog();
  current = dialog;
  dialog.querySelector('[data-dialog-message]')!.textContent = message;
  dialog.querySelector('[data-dialog-confirm]')!.textContent = confirmLabel;
  dialog.querySelector<HTMLElement>('[data-dialog-cancel]')!.hidden = !cancel;
  return new Promise((resolve) => {
    // A queued close event belongs to this request even if another dialog has opened.
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
      if (current === dialog) current = null;
    }, { once: true });
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-confirm]')!.focus();
  });
}

export const confirmDialog = (message: string, confirmLabel = 'OK') => open(message, confirmLabel, true);
export const notice = (message: string) => open(message, 'OK', false).then(() => undefined);
