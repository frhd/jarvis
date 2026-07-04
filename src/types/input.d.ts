declare module 'input' {
  export default {
    text(prompt: string): Promise<string>;
  };
}
