import { z } from "zod"
import { randomUUID } from "node:crypto"
import { prisma } from "../../lib/prisma"
import { redis } from "../../lib/redis"
import { FastifyInstance } from "fastify"
import { voting } from "../../utils/voting_pub_sub"

export async function voteOnPoll(app: FastifyInstance) {
  app.post("/polls/:pollId/votes", async (request, reply) => {
    const voteOnPollBody = z.object({
      pollOptionId: z.string().uuid(),
    })

    const voteOnPollParams = z.object({
      pollId: z.string().uuid(),
    })

    const { pollId } = voteOnPollParams.parse(request.params)
    const { pollOptionId } = voteOnPollBody.parse(request.body)

    let { sessionId } = request.cookies

    /* Para verificar se o usuario ja votou lançar um alerta para ele */
    if (sessionId) {
      const userPreviousVoteOnPoll = await prisma.vote.findUnique({
        where: {
          sessionId_pollId: {
            sessionId,
            pollId,
          },
        },
      })

      /*Se o Usuario ja votou anteriormente  e o voto 
      que ele esta fazendo é diferente de esse voto que 
      ja fez antes eu quero apagar o voto anterior 
      e criar um novo
      */

      if (
        userPreviousVoteOnPoll &&
        userPreviousVoteOnPoll.pollOptionId != pollOptionId
      ) {
        // se a condição é verdadeira apaga o voto anterior
        // cria um novo voto
        await prisma.vote.delete({
          where: {
            id: userPreviousVoteOnPoll.id,
          },
        })

         const votes = await redis.zincrby(pollId, -1, userPreviousVoteOnPoll.pollOptionId)

        voting.publish(pollId, {
        pollOptionId: userPreviousVoteOnPoll.pollOptionId,
        votes: Number(votes),
        })

      } else if (userPreviousVoteOnPoll) {
        return reply
          .status(400)
          .send({ message: "You already voted on this poll." })
      }
    }

    if (!sessionId) {
      sessionId = randomUUID()

      reply.setCookie("sessionId", sessionId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        signed: true, // o usuario nao conseguira manualmente alterar o valor do cookie
        httpOnly: true, // somente o back end consegue accesar a informação do cookie
      })
    }

    await prisma.vote.create({
      data: {
        sessionId,
        pollId,
        pollOptionId,
      },
    })

    const votes = await redis.zincrby(pollId, 1, pollOptionId)

    voting.publish(pollId, {
      pollOptionId,
      votes: Number(votes),
    })

    return reply.status(201).send()
  })
}
