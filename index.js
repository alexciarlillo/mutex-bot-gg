require("dotenv").config();
const moment = require("moment");
const Guilded = require("./libs/Guilded");
const DataStore = require("./libs/DataStore");

async function main() {
    const commandPrefix = process.env.BOT_PREFIX;

    if (!commandPrefix) {
        throw new Error("command prefix must be defined");
    }

    const botClient = new Guilded({
        token: process.env.BOT_TOKEN,
        apiUrl: process.env.API_URL,
        socketUrl: process.env.WS_URL,
    });

    const dataStore = new DataStore({
        persistentDataFile: `${__dirname}/resources.json`,
        defaultData: {},
    });

    await dataStore.initialize();

    const resources = dataStore.data;

    getResource = (serverId, name) => {
        return resources[serverId]?.find((r) => r.name === name);
    };

    addResource = (serverId, resource) => {
        if (resources[serverId]) {
            resources[serverId].push(resource);
        } else {
            resources[serverId] = [resource];
        }
    };

    handleRegister = (serverId, args, createdBy) => {
        const name = args.shift();

        let resource = getResource(serverId, name);

        if (resource) {
            return `Resource **${name}** is already registered.`;
        }

        const timeout = args.shift();

        resource = {
            name,
            createdBy,
            lockedBy: null,
            lockedUntil: null,
            timeout: timeout ?? process.env.RESOURCE_DEFAUL_TIMEOUT_MINS,
        };

        addResource(serverId, resource);

        return `Registered new lockable resource: **${name}**`;
    };

    handleLock = (serverId, args, createdBy) => {
        const name = args.shift();

        let resource = getResource(serverId, name);

        if (!resource) {
            return `Resource **${name}** not found.`;
        }

        if (resource.lockedBy) {
            return `Resource **${name}** is already locked by <@${resource.lockedBy}>`;
        }

        resource.lockedBy = createdBy;
        resource.lockedUntil = moment().add(resource.timeout, "minutes").unix();

        setTimeout(() => {
            console.log("lock timeout expired");
            resource.lockedBy = null;
            resource.lockedUntil = null;
            resource.lockTimeoutId = null;
        }, resource.timeout * 60 * 1000);

        return `Resource **${name}** is now locked.`;
    };

    handleUnlock = (serverId, args, createdBy) => {
        const name = args.shift();

        let resource = getResource(serverId, name);

        if (!resource) {
            return `Resource **${name}** not found.`;
        }

        if (!resource.lockedBy) {
            return `Resource **${name}** is not locked.`;
        }

        if (resource.lockedBy !== createdBy) {
            return `You cannot unlocked this resource. It was locked by <@${resource.lockedBy}>.`;
        }

        if (resource.lockTimeout) {
            clearTimeout(resource.lockTimeout);
        }

        resource.lockedBy = null;
        resource.lockedUntil = null;
        resource.lockTimeoutId = null;

        return `Resource **${name}** is now unlocked.`;
    };

    handleList = (serverId) => {
        const serverResources = resources[serverId];

        if (!serverResources) {
            return `No resources have been registered for this server.`;
        }

        let response = "";
        serverResources.forEach((resource) => {
            const lockedStatus = resource.lockedBy
                ? `:lock: by <@${resource.lockedBy}>`
                : `:unlock:`;

            response += `Name: **${resource.name}** | Status: ${lockedStatus} | Created By: <@${resource.createdBy}> | Timeout (mins): ${resource.timeout}\n\n`;
        });

        return response;
    };

    handleRemove = (serverId, args, createdBy) => {
        const name = args.shift();

        let resource = getResource(serverId, name);

        if (!resource) {
            return `Resource **${name}** not found.`;
        }

        if (resource.createdBy !== createdBy) {
            return `Cannot remove a resource you did not create.`;
        }

        let resourceIndex = resources[serverId]?.findIndex(
            (r) => r.name === name
        );

        if (resourceIndex >= 0) {
            resources[serverId].splice(resourceIndex, 1);
        }

        return `Resource **${name}** has been removed.`;
    };

    handleStatus = (serverId, args) => {
        const name = args.shift();

        let resource = getResource(serverId, name);

        if (!resource) {
            return `Resource **${name}** not found.`;
        }

        if (resource.lockedBy) {
            return `Resource **${name}** is :lock: by <@${
                resource.lockedBy
            }> until ${moment(resource.lockedUntil).format()}.`;
        } else {
            return `Resource **${name}** is :unlock:.`;
        }
    };

    botClient.when("ChatMessageCreated", async (eventData) => {
        const {
            message: { id: messageId, channelId, createdBy, content, serverId },
        } = eventData;

        if (
            !content.startsWith(commandPrefix) ||
            createdBy === botClient.user.id
        ) {
            return;
        }

        const args = content.slice(commandPrefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        let responseContent = "Unknown command or bad arguments.";

        switch (command) {
            case "register":
                responseContent = handleRegister(serverId, args, createdBy);
                break;
            case "lock":
                responseContent = handleLock(serverId, args, createdBy);
                break;
            case "unlock":
                responseContent = handleUnlock(serverId, args, createdBy);
                break;
            case "list":
                responseContent = handleList(serverId);
                break;
            case "status":
                responseContent = handleStatus(serverId, args);
                break;
            case "remove":
                responseContent = handleRemove(serverId, args, createdBy);
                break;
            default:
                break;
        }

        botClient.postApi(`/channels/${channelId}/messages`, {
            replyMessageIds: [messageId],
            isSilent: true,
            embeds: [
                {
                    description: responseContent,
                },
            ],
        });
    });

    botClient.start();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
