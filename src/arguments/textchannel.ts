import { botCache } from "../../mod.ts";
import { ChannelTypes } from "../../deps.ts";

botCache.arguments.set("textchannel", {
  name: "textchannel",
  execute: async function (_argument, parameters, message) {
    const [id] = parameters;
    if (!id) return;

    const guild = message.guild();
    if (!guild) return;

    const channelIDOrName = id.startsWith("<#")
      ? id.substring(2, id.length - 1)
      : id.toLowerCase();

    const channel = guild.channels.get(channelIDOrName) ||
      guild.channels.find((channel) => channel.name === channelIDOrName);

    if (channel?.type !== ChannelTypes.GUILD_TEXT) return;

    return channel;
  },
});
