import * as FileSystem from 'expo-file-system';
import { AnalysisResponse, PassEvent } from '../types';

export async function classifyLongExposure({
  backendUrl,
  imageUri,
  nearestPass,
  exifDateTime,
}: {
  backendUrl: string;
  imageUri: string;
  nearestPass: PassEvent | null;
  exifDateTime: string | null;
}): Promise<AnalysisResponse> {
  const formData = new FormData();
  formData.append('image', {
    uri: imageUri,
    name: 'long_exposure.jpg',
    type: 'image/jpeg',
  } as any);

  if (nearestPass) {
    formData.append('nearest_pass_start', nearestPass.startIso);
    formData.append('nearest_pass_end', nearestPass.endIso);
    formData.append('nearest_pass_direction', nearestPass.directionText);
  }
  if (exifDateTime) formData.append('exif_datetime', exifDateTime);

  const response = await fetch(`${backendUrl}/analyze-photo`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Failed to classify image');
  }

  return (await response.json()) as AnalysisResponse;
}
