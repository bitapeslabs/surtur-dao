import { FAKE_DELAY_LOAD } from '@/consts';

/** Dev-only artificial latency so skeleton loaders are visible. */
export async function fakeLoadDelay(): Promise<void> {
  if (FAKE_DELAY_LOAD > 0) {
    await new Promise((resolve) => setTimeout(resolve, FAKE_DELAY_LOAD));
  }
}
