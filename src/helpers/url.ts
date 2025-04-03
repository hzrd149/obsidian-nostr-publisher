export function isValidUrl(url: string) {
  try {
    new URL(url);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}
