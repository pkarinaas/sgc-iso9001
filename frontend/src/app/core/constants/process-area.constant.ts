/**
 * Standardized processes and operational areas.
 */

export interface ProcessAreaOption {
  label: string;
  value: string;
}

export const PROCESS_AREAS: ProcessAreaOption[] = [
  { label: 'Química Clínica', value: 'quimica_clinica' },
  { label: 'Bacteriología', value: 'bacteriologia' },
  { label: 'Guardia', value: 'guardia' },
  { label: 'Hematología', value: 'hematologia' },
  { label: 'Inmunología', value: 'inmunologia' },
  { label: 'Control de Calidad', value: 'control_calidad' },
];
