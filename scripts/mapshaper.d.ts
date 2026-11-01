declare module "mapshaper" {
  const mapshaper: {
    /** 入力ファイル名 -> 内容 を渡し、出力ファイル名 -> 内容 を受け取る */
    applyCommands(
      commands: string,
      input?: Record<string, string | Buffer>,
    ): Promise<Record<string, string | Buffer>>;
  };
  export default mapshaper;
}
