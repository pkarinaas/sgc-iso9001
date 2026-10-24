import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  inject,
  isDevMode,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { PrimeNG, PRIME_NG_CONFIG } from 'primeng/config';
import Aura from '@primeng/themes/aura';
import { definePreset } from '@primeuix/themes';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';

const SgcPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{rose.50}',
      100: '{rose.100}',
      200: '{rose.200}',
      300: '{rose.300}',
      400: '{rose.400}',
      500: '{rose.600}',
      600: '{rose.700}',
      700: '{rose.800}',
      800: '{rose.900}',
      900: '{rose.950}',
      950: '{rose.950}',
    },
  },
});

/** PrimeNG theme and options configuration. */
const primeNGConfig = {
  theme: {
    preset: SgcPreset,
    options: {
      // Force light mode globally — this intranet has no dark-mode toggle.
      darkModeSelector: false as const,
      cssLayer: {
        name: 'primeng',
        order: 'primeng, app-styles',
      },
    },
  },
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimationsAsync(),
    {
      provide: PRIME_NG_CONFIG,
      useValue: primeNGConfig,
    },
    provideAppInitializer(() => {
      const primeNG = inject(PrimeNG);
      primeNG.setConfig(primeNGConfig);
      primeNG.setTranslation({
        noFileChosenMessage: 'Ningún archivo seleccionado',
        fileChosenMessage: '{0} archivos seleccionados',
      });
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
