/**
 * The SRD view's lazy-loading entry: the view together with its styles, so
 * both arrive in one chunk on first visit and neither weighs on the bundle
 * every session downloads.
 *
 * Separate from SrdView.tsx because the CSS import cannot be evaluated
 * outside a bundler, where the view's tests run.
 */
import './SrdView.css';

export { default } from './SrdView';
