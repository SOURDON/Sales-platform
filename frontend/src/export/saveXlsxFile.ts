import { isTauriRuntime } from '../desktop/tauri';

export type SaveXlsxResult = 'saved' | 'cancelled';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function downloadViaAnchor(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveViaTauri(buffer: ArrayBuffer, filename: string): Promise<SaveXlsxResult> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (!path) {
    return 'cancelled';
  }
  await writeFile(path, new Uint8Array(buffer));
  return 'saved';
}

async function saveViaFilePicker(buffer: ArrayBuffer, filename: string): Promise<SaveXlsxResult> {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (!picker) {
    downloadViaAnchor(buffer, filename);
    return 'saved';
  }
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [{ description: 'Excel', accept: { [XLSX_MIME]: ['.xlsx'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(buffer);
    await writable.close();
    return 'saved';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled';
    }
    throw error;
  }
}

/** Сохранить .xlsx: на десктопе — системный диалог, в браузере — «Сохранить как» (если доступно). */
export async function saveXlsxFile(
  buffer: ArrayBuffer,
  filename: string,
): Promise<SaveXlsxResult> {
  if (isTauriRuntime()) {
    return saveViaTauri(buffer, filename);
  }
  return saveViaFilePicker(buffer, filename);
}
