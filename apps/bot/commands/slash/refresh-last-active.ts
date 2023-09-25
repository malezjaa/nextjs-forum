import { Colors, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { SlashCommand } from '../types.js'
import { replyWithEmbed } from '../../utils.js'
import { db, sql } from '@nextjs-forum/db/node'
import { baseLog } from '../../log.js'

const log = baseLog.extend('refresh-last-active')

export const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('refresh-last-active')
    .setDescription(
      'Refreshes the last active time for every post (expensive call so only use it if really necessary)',
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await replyWithEmbed(interaction, {
      title: '⌛ Processing...',
      description:
        'Your request has been queued. This might take a while to complete...',
    })

    try {
      log('Loading all posts with dates...')

      // update posts with lastmod time
      const posts = await db
        .selectFrom('posts')
        .select([
          'posts.snowflakeId',
          sql<Date>`MAX(IFNULL(posts.editedAt, posts.createdAt))`.as(
            'lastModTime',
          ),
          sql<Date>`MAX(IFNULL(messages.editedAt, messages.createdAt))`.as(
            'lastMessageModTime',
          ),
        ])
        .leftJoin('messages', 'posts.snowflakeId', 'messages.postId')
        .groupBy('posts.snowflakeId')
        .execute()

      log('Loaded %d posts, executing transaction', posts.length)

      await db.transaction().execute(async (trx) => {
        for (const post of posts) {
          const lastActive =
            post.lastMessageModTime > post.lastModTime
              ? post.lastMessageModTime
              : post.lastModTime

          await trx
            .updateTable('posts')
            .where('posts.snowflakeId', '=', post.snowflakeId)
            .set({ lastActiveAt: lastActive })
            .execute()
        }
      })

      log('Transaction completed')

      await interaction.editReply({
        embeds: [
          {
            title: '✅ Success!',
            description: 'The answer count of the users has been updated',
            color: Colors.Green,
          },
        ],
      })
    } catch (err) {
      const description = err instanceof Error ? err.message : 'Unknown reason'

      await interaction.editReply({
        embeds: [
          {
            title: 'Error',
            description,
          },
        ],
      })
    }
  },
}
