import { publicError } from "@/lib/public-error";
import { googleRequest, googleResponse } from "./google";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  description?: string;
  capabilities?: { canDownload?: boolean };
};

const fields =
  "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,description,capabilities(canDownload))";

export async function listDriveFiles(query: string) {
  const escaped = query.trim().replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const params = new URLSearchParams({
    pageSize: "50",
    fields,
    orderBy: "modifiedTime desc",
    q: `trashed = false${escaped ? ` and name contains '${escaped}'` : ""}`,
  });
  return googleRequest<{ files?: DriveFile[]; nextPageToken?: string }>(
    "drive",
    `/files?${params}`,
  );
}

async function boundedText(response: Response): Promise<string> {
  const max = 1_000_000;
  const reader = response.body?.getReader();
  if (!reader) publicError("Drive returned no readable content.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max)
        publicError("The Drive file is over the 1 MB text-reading limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function readDriveFile(id: string) {
  const path = `/files/${encodeURIComponent(id)}`;
  const params = new URLSearchParams({
    fields:
      "id,name,mimeType,size,modifiedTime,webViewLink,description,capabilities(canDownload)",
  });
  const file = await googleRequest<DriveFile>("drive", `${path}?${params}`);
  if (!file.capabilities?.canDownload)
    return {
      file,
      note: "This file cannot be downloaded through the connected account.",
    };
  let contentPath: string;
  if (file.mimeType === "application/vnd.google-apps.document")
    contentPath = `${path}/export?mimeType=text%2Fplain`;
  else if (file.mimeType === "application/vnd.google-apps.spreadsheet")
    contentPath = `${path}/export?mimeType=text%2Fcsv`;
  else if (
    /^(text\/|application\/(json|xml|javascript|x-yaml))/.test(file.mimeType)
  )
    contentPath = `${path}?alt=media`;
  else
    return {
      file,
      note: "This file type is listed, but only text files, Google Docs and Sheets can be read here.",
    };
  const content = await boundedText(await googleResponse("drive", contentPath));
  return { file, content };
}
