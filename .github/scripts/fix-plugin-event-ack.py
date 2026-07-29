from pathlib import Path

path = Path('apps/bot/src/bot.ts')
text = path.read_text()
text = text.replace(
"""    this.client.on(Events.MessageDelete, async (message) => {
      if (!message.guildId) return;
      await this.dispatchGuildPluginEvent(message.guildId, Events.MessageDelete, message);
    });""",
"""    this.client.on(Events.MessageDelete, async (message) => {
      if (!message.guildId) return;
      await this.dispatchGuildPluginEvent(message.guildId, Events.MessageDelete, message);
    });""",
)
text = text.replace(
"""    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.guildId) {
        await this.dispatchGuildPluginEvent(interaction.guildId, Events.InteractionCreate, interaction);
      }
      if (!interaction.isChatInputCommand()) return;
""",
"""    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.guildId) {
        const dispatch = await this.dispatchGuildPluginEvent(
          interaction.guildId,
          Events.InteractionCreate,
          interaction,
        );
        if (
          dispatch.failed &&
          !interaction.isChatInputCommand() &&
          interaction.isRepliable() &&
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content: 'Plugin操作の処理中にエラーが発生しました',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }
      if (!interaction.isChatInputCommand()) return;
""",
)
old = """  private async dispatchGuildPluginEvent(
    guildId: string,
    eventName: string,
    payload: unknown,
  ): Promise<void> {
    try {
      const events = await this.pluginLoader.getGuildEvents(guildId);
      for (const event of events.filter((candidate) => candidate.event === eventName)) {
        try {
          await event.handler(payload);
        } catch (error) {
          this.logger.error(
            { err: error, guildId, event: eventName },
            'Plugin Event Handlerの実行に失敗しました',
          );
        }
      }
    } catch (error) {
      this.logger.error(
        { err: error, guildId, event: eventName },
        'Guild Plugin Eventの取得に失敗しました',
      );
    }
  }
"""
new = """  private async dispatchGuildPluginEvent(
    guildId: string,
    eventName: string,
    payload: unknown,
  ): Promise<{ matched: number; failed: boolean }> {
    try {
      const events = await this.pluginLoader.getGuildEvents(guildId);
      const handlers = events.filter((candidate) => candidate.event === eventName);
      let failed = false;
      for (const event of handlers) {
        try {
          await event.handler(payload);
        } catch (error) {
          failed = true;
          this.logger.error(
            { err: error, guildId, event: eventName },
            'Plugin Event Handlerの実行に失敗しました',
          );
        }
      }
      return { matched: handlers.length, failed };
    } catch (error) {
      this.logger.error(
        { err: error, guildId, event: eventName },
        'Guild Plugin Eventの取得に失敗しました',
      );
      return { matched: 0, failed: true };
    }
  }
"""
if old not in text:
    raise RuntimeError('dispatch method pattern not found')
text = text.replace(old, new)
path.write_text(text)
