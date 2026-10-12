// Browser-only: fetch() has no upload progress, so large ZIP/video uploads go through XHR.
export function uploadWithProgress<T>(url: string, body: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => {
      const result = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(result as T);
      else reject(new Error(typeof result?.error === "string" ? result.error : xhr.status === 413 ? "文件过大。" : "请求失败，请稍后重试。"));
    };
    xhr.onerror = () => reject(new Error("无法连接 AI Hub 服务。"));
    xhr.send(body);
  });
}
