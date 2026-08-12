import { beginNewWorksDiagnosticSpan } from '../../features/newWorks/newWorksDiagnostics';

export async function measureNewWorksInitializationPhase<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const end = beginNewWorksDiagnosticSpan(name);
  try {
    return await run();
  } finally {
    end();
  }
}
