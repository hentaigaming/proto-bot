import { Message, logger, Guild, cache } from "../../deps.ts";
import { configs } from "../../configs.ts";
import { botCache } from "../../mod.ts";
import { handleError } from "../utils/errors.ts";
import { Command } from "../types/commands.ts";

export const parsePrefix = (guildID: string | undefined) => {
  const prefix = guildID ? botCache.guildPrefixes.get(guildID) : configs.prefix;
  return prefix || configs.prefix;
};

export const parseCommand = (commandName: string) => {
  const command = botCache.commands.get(commandName);
  if (command) return command;

  // Check aliases if the command wasn't found
  const alias = botCache.commandAliases.get(commandName);
  if (!alias) return;

  return botCache.commands.get(alias);
};

export const logCommand = (
  message: Message,
  guildName: string,
  type: string,
  commandName: string,
) => {
  logger.success(
    `[COMMAND:${commandName} - ${type}] by ${message.author.username}#${message.author.discriminator} in ${guildName}`,
  );
};

/** Parses all the arguments for the command based on the message sent by the user. */
async function parseArguments(
  message: Message,
  command: Command,
  parameters: string[],
) {
  const args: { [key: string]: unknown } = {};
  if (!command.arguments) return args;

  let missingRequiredArg = false;

  // Clone the parameters so we can modify it without editing original array
  const params = [...parameters];

  // Loop over each argument and validate
  for (const argument of command.arguments) {
    const resolver = botCache.arguments.get(argument.type || "string");
    if (!resolver) continue;

    const result = await resolver.execute(argument, params, message);
    if (result) {
      // Assign the valid argument
      args[argument.name] = result;
      // This will use up all args so immediately exist the loop.
      if (argument.type && ["...string"].includes(argument.type)) {
        break;
      }
      // Remove a param for the next argument
      params.shift();
      continue;
    }

    // Invalid arg provided.
    if (argument.defaultValue) args[argument.name] = argument.defaultValue;
    else if (argument.required) {
      missingRequiredArg = true;
      argument.missing?.(message);
      break;
    }
  }

  // If an arg was missing then return false so we can error out as an object {} will always be truthy
  return missingRequiredArg ? false : args;
}

/** Finds the subcommand based on its name or aliases. */
function parseSubcommand(command: Command, name: string) {
  if (!command.subcommands?.size || !name) return;

  const commandName = name.toLowerCase();
  const isCommand = command.subcommands.get(commandName);
  if (isCommand) return isCommand;

  // Check subcommand aliases
  const isAlias = botCache.commandAliases.get(`${command.name}-${commandName}`);
  if (isAlias) return command.subcommands.get(isAlias);
}

/** Runs the inhibitors to see if a command is allowed to run. */
async function commandAllowed(
  message: Message,
  command: Command,
  guild?: Guild,
) {
  const inhibitorResults = await Promise.all(
    [...botCache.inhibitors.values()].map((inhibitor) =>
      inhibitor(message, command, guild)
    ),
  );

  if (inhibitorResults.includes(true)) {
    logCommand(message, guild?.name || "DM", "Inhibited", command.name);
    return false;
  }

  return true;
}

// The monitor itself for this file. Above is helper functions for this monitor.
botCache.monitors.set("commandHandler", {
  name: "commandHandler",
  /** The main code that will be run when this monitor is triggered. */
  execute: async function (message: Message) {
    // If the message was sent by a bot we can just ignore it
    if (message.author.bot) return;

    const prefix = parsePrefix(message.guildID);
    // If the message is not using the valid prefix cancel the command
    if (!message.content.startsWith(prefix)) return;

    // Get the first word of the message without the prefix so it is just command name. `!ping testing` becomes `ping`
    const [commandName, ...parameters] = message.content.substring(
      prefix.length,
    )
      .split(
        " ",
      );

    // Check if this is a valid command
    const command = parseCommand(commandName);
    if (!command) return;

    const guild = message.guild();
    logCommand(message, guild?.name || "DM", "Ran", commandName);

    // Parsed args and validated
    const args = await parseArguments(message, command, parameters) as {
      [key: string]: any;
    } | false;
    // Some arg that was required was missing and handled already
    if (!args) return;

    try {
      // If no subcommand execute the command
      const [argument] = command.arguments || [];
      if (!argument || argument.type !== "subcommand") {
        // Check subcommand permissions and options
        if (!(await commandAllowed(message, command, guild))) return;
        await command.execute(message, args, guild);
        return logCommand(
          message,
          guild?.name || "DM",
          "Success",
          commandName,
        );
      }

      // A subcommand was asked for in this command
      const subcommand = parseSubcommand(command, args[argument.name]);
      if (!subcommand) {
        await command.execute(message, args, guild);

        // Log that the command ran successfully.
        return logCommand(
          message,
          guild?.name || "DM",
          "Success",
          commandName,
        );
      }

      // Check subcommand permissions and options
      if (!(await commandAllowed(message, subcommand, guild))) return;
      // Parse the args and then execute the subcommand
      await subcommand.execute(message, args, guild);
      // Log that the command ran successfully.
      logCommand(message, guild?.name || "DM", "Success", commandName);
    } catch (error) {
      logCommand(message, guild?.name || "DM", "Failed", commandName);
      logger.error(error);
      handleError(message, error);
    }
  },
});
