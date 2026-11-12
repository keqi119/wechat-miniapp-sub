import {z} from 'zod';

/** New staff credentials retain their exact bytes; only length is constrained. */
export const staffPassword = z.string().min(8).max(256);
