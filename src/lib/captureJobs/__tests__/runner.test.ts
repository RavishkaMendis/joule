// ═══════════════════════════════════════════════════════════════════════
// runner.ts is the one file in this module that calls into src/lib/ai/**
// (settled/tested elsewhere — this task calls it, does not edit it), so
// it's the one file here that mocks those calls wholesale, mirroring the
// pattern already used for scheduler.ts/expo-notifications.
// ═══════════════════════════════════════════════════════════════════════

const mockReadFileAsBase64 = jest.fn();
const mockRunLabelOcr = jest.fn();
const mockRunMealPhoto = jest.fn();
const mockRunVoiceParse = jest.fn();

jest.mock('../../ai/media', () => ({
  readFileAsBase64: (...args: unknown[]) => mockReadFileAsBase64(...args),
}));

jest.mock('../../ai/runs', () => ({
  runLabelOcr: (...args: unknown[]) => mockRunLabelOcr(...args),
  runMealPhoto: (...args: unknown[]) => mockRunMealPhoto(...args),
  runVoiceParse: (...args: unknown[]) => mockRunVoiceParse(...args),
}));

import { executeCaptureJob } from '../runner';

const OK_RESULT = { ok: true, entries: [], rejectedCount: 0 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('label_ocr', () => {
  it('uses the already-in-memory base64 without touching the filesystem', async () => {
    mockRunLabelOcr.mockResolvedValue(OK_RESULT);
    await executeCaptureJob({ kind: 'label_ocr', photoUri: 'file:///label.jpg', photoBase64: 'BASE64', photoMimeType: 'image/jpeg' });

    expect(mockReadFileAsBase64).not.toHaveBeenCalled();
    expect(mockRunLabelOcr).toHaveBeenCalledWith('BASE64', 'image/jpeg');
  });

  it('re-reads the file when no in-memory base64 survived (e.g. a post-restart retry)', async () => {
    mockReadFileAsBase64.mockResolvedValue('REREAD_BASE64');
    mockRunLabelOcr.mockResolvedValue(OK_RESULT);

    await executeCaptureJob({ kind: 'label_ocr', photoUri: 'file:///label.jpg' });

    expect(mockReadFileAsBase64).toHaveBeenCalledWith('file:///label.jpg');
    expect(mockRunLabelOcr).toHaveBeenCalledWith('REREAD_BASE64', undefined);
  });
});

describe('meal_photo', () => {
  it('passes the text note and photo through with no voice note', async () => {
    mockRunMealPhoto.mockResolvedValue(OK_RESULT);
    await executeCaptureJob({ kind: 'meal_photo', photoUri: 'file:///photo.jpg', photoBase64: 'PHOTO', textNote: 'chicken sushi' });

    expect(mockRunMealPhoto).toHaveBeenCalledWith('PHOTO', {
      photoMimeType: undefined,
      textNote: 'chicken sushi',
      voiceNote: undefined,
    });
  });

  it('attaches the voice note when present, reading it from disk', async () => {
    mockReadFileAsBase64.mockResolvedValue('AUDIO_BASE64');
    mockRunMealPhoto.mockResolvedValue(OK_RESULT);

    await executeCaptureJob({
      kind: 'meal_photo',
      photoUri: 'file:///photo.jpg',
      photoBase64: 'PHOTO',
      voiceNoteUri: 'file:///note.m4a',
      voiceNoteMimeType: 'audio/m4a',
    });

    expect(mockReadFileAsBase64).toHaveBeenCalledWith('file:///note.m4a');
    expect(mockRunMealPhoto).toHaveBeenCalledWith('PHOTO', {
      photoMimeType: undefined,
      textNote: undefined,
      voiceNote: { audioBase64: 'AUDIO_BASE64', mimeType: 'audio/m4a' },
    });
  });

  it('proceeds with the photo alone when the voice note fails to read, rather than failing the whole job', async () => {
    mockReadFileAsBase64.mockRejectedValue(new Error('file gone'));
    mockRunMealPhoto.mockResolvedValue(OK_RESULT);

    const result = await executeCaptureJob({
      kind: 'meal_photo',
      photoUri: 'file:///photo.jpg',
      photoBase64: 'PHOTO',
      voiceNoteUri: 'file:///note.m4a',
    });

    expect(result).toBe(OK_RESULT);
    expect(mockRunMealPhoto).toHaveBeenCalledWith('PHOTO', {
      photoMimeType: undefined,
      textNote: undefined,
      voiceNote: undefined,
    });
  });

  it('propagates a failure to read the PHOTO itself (not caught, unlike the voice note)', async () => {
    mockReadFileAsBase64.mockRejectedValue(new Error('photo file gone'));

    await expect(executeCaptureJob({ kind: 'meal_photo', photoUri: 'file:///photo.jpg' })).rejects.toThrow('photo file gone');
    expect(mockRunMealPhoto).not.toHaveBeenCalled();
  });
});

describe('voice', () => {
  it('uses the in-memory base64 without touching the filesystem', async () => {
    mockRunVoiceParse.mockResolvedValue(OK_RESULT);
    await executeCaptureJob({ kind: 'voice', audioUri: 'file:///note.m4a', audioBase64: 'AUDIO', mimeType: 'audio/m4a' });

    expect(mockReadFileAsBase64).not.toHaveBeenCalled();
    expect(mockRunVoiceParse).toHaveBeenCalledWith('AUDIO', 'audio/m4a');
  });

  it('re-reads the file when no in-memory base64 survived', async () => {
    mockReadFileAsBase64.mockResolvedValue('REREAD_AUDIO');
    mockRunVoiceParse.mockResolvedValue(OK_RESULT);

    await executeCaptureJob({ kind: 'voice', audioUri: 'file:///note.m4a', mimeType: 'audio/m4a' });

    expect(mockReadFileAsBase64).toHaveBeenCalledWith('file:///note.m4a');
    expect(mockRunVoiceParse).toHaveBeenCalledWith('REREAD_AUDIO', 'audio/m4a');
  });
});
