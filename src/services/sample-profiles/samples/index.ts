import { MARK_ALLEN_SAMPLE } from './markAllen';
import { SHANNON_LAL_SAMPLE, SHANNON_LAL_SAMPLE_SECOND_COPY } from './shannonLal';

/**
 * The profiles the Dummy data dialog starts with. They are written to the
 * database the first time the dialog is opened; after that they are ordinary
 * records the user can edit or delete.
 */
export const SEED_SAMPLES: { title: string; content: string }[] = [
  { title: 'Mark Allen — DevOps Engineer and Evangelist', content: MARK_ALLEN_SAMPLE },
  { title: 'Shannon Lal — VP Technology and Engineering', content: SHANNON_LAL_SAMPLE },
  { title: 'Shannon Lal — VP Technology and Engineering (second copy)', content: SHANNON_LAL_SAMPLE_SECOND_COPY },
];
