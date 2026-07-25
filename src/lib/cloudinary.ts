import { env } from "@/env";

export async function uploadResumePhoto(
  file: File,
  userId: string,
): Promise<{ secure_url: string }> {
  // Create FormData for unsigned upload to Cloudinary
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", env.CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", `resume-photos/${userId}`);

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("Cloudinary upload error:", error);
      throw new Error(`Cloudinary upload failed: ${response.status}`);
    }

    const data = (await response.json()) as { secure_url: string };
    return { secure_url: data.secure_url };
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    throw error;
  }
}
