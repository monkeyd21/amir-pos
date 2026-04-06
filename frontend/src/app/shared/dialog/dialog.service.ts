import {
  Injectable,
  Injector,
  Type,
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
} from '@angular/core';
import { DialogRef } from './dialog-ref';
import { DIALOG_DATA } from './dialog.tokens';

export interface DialogConfig<D = any> {
  data?: D;
  width?: string;
  maxWidth?: string;
  panelClass?: string;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  constructor(
    private injector: Injector,
    private appRef: ApplicationRef,
    private envInjector: EnvironmentInjector
  ) {}

  open<T, D = any, R = any>(
    component: Type<T>,
    config: DialogConfig<D> = {}
  ): DialogRef<R> {
    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.style.cssText =
      'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;';

    // Create panel wrapper
    const panel = document.createElement('div');
    panel.className = 'dialog-panel';
    panel.style.cssText = `position:relative;z-index:9001;max-height:90vh;overflow:auto;${
      config.width ? 'width:' + config.width + ';' : ''
    }${config.maxWidth ? 'max-width:' + config.maxWidth + ';' : 'max-width:90vw;'}`;

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const dialogRef = new DialogRef<R>();

    // Create component
    const componentRef = createComponent(component, {
      environmentInjector: this.envInjector,
      elementInjector: Injector.create({
        parent: this.injector,
        providers: [
          { provide: DialogRef, useValue: dialogRef },
          { provide: DIALOG_DATA, useValue: config.data },
        ],
      }),
      hostElement: panel,
    });

    this.appRef.attachView(componentRef.hostView);

    // Wire up cleanup
    const cleanup = () => {
      backdrop.classList.add('dialog-closing');
      setTimeout(() => {
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
        backdrop.remove();
      }, 150);
    };

    dialogRef._setCleanup(cleanup);

    // Close on backdrop click
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) {
        dialogRef.close();
      }
    });

    // Close on Escape
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dialogRef.close();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);

    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.add('dialog-open');
    });

    return dialogRef;
  }
}
