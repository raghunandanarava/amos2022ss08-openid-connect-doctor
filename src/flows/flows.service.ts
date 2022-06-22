import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { DiscoveryService } from '../discovery/discovery.service';
import { ClientCredentialFlowResultDto } from './Dto/clientCredentialFlowResult.dto';

@Injectable()
export class FlowsService {
  @Inject(TokenService)
  private readonly tokenService: TokenService;

  @Inject(DiscoveryService)
  private readonly discoveryService: DiscoveryService;

  async clientCredentials(
    issuer_s: string,
    clientId: string,
    clientSecret: string,
  ) {
    if (issuer_s === undefined || issuer_s === '') {
      throw new HttpException(
        'There was no issuer to validate the token against!',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (clientId === undefined || clientId === '') {
      throw new HttpException(
        'There was no client id provided',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (clientSecret === undefined || clientSecret === '') {
      throw new HttpException(
        'There was no client secret provided',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const issuer = await this.discoveryService.get_issuer(issuer_s);
    const receivedToken = await this.tokenService.getToken(
      String(issuer.token_endpoint),
      {
        grant_type: process.env.CLIENT_CREDENTIALS_STRING,
        client_id: clientId,
        client_secret: clientSecret,
        audience: process.env.AUDIENCE,
      },
    );

    const result = await this.tokenService
      .decodeToken(String(receivedToken.data.access_token))
      .then(async ([payload, header]) => {
        const validationResult = await this.tokenService
          .validateTokenSignature(
            process.env.ISSUER_STRING,
            String(receivedToken.data.access_token),
            true,
            '',
            '',
          )
          .then(
            ([isValid, message]) =>
              new ClientCredentialFlowResultDto({
                success: isValid,
                message: message,
                payload: payload,
                header: header,
              }),
          )
          .catch(
            () =>
              new ClientCredentialFlowResultDto({
                success: false,
                message: 'An unexpected failure happend during validation!',
                payload: payload,
                header: header,
              }),
          );

        return validationResult;
      })
      .catch(
        (error) =>
          new ClientCredentialFlowResultDto({
            success: true,
            message: `An error occurred ${error}`,
            payload: undefined,
            header: undefined,
          }),
      );

    return result;
  }
}
