//SDPX-License-Identifier: MIT
//SDPX-FileCopyrightText: 2022 Philip Rebbe <rebbe.philip@fau.de>

import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import * as jose from 'jose';
import { GrantBody } from 'openid-client';
import axios from 'axios';
import * as qs from 'qs';
import { join } from 'path';
import * as fs from 'fs';
import { SettingsService } from '../settings/settings.service';
import { HelperService } from '../helper/helper.service';

@Injectable()
export class TokenService {
  @Inject(HelperService)
  private readonly helperService: HelperService;
  @Inject(SettingsService)
  private readonly settingsService: SettingsService;

  async getSchemas(schema_s: string) {
    return this.helperService.getSchemasHelper(schema_s, 'token');
  }

  async getIssuer(issuer_s: string) {
    if (issuer_s === undefined || issuer_s === '') {
      throw new HttpException(
        'There was no issuer string passed to get the issuer',
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.helperService.get_issuer(issuer_s);
  }

  async getToken(token_endpoint: string, grantBody: GrantBody): Promise<any> {
    if (token_endpoint === undefined || token_endpoint === '') {
      throw new HttpException(
        'No or Empty token endpoint has been received',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (grantBody.grant_type === undefined || grantBody.grant_type === '') {
      throw new HttpException(
        'No or Empty grant_type has been received',
        HttpStatus.BAD_REQUEST,
      );
    }
    return await axios
      .post(token_endpoint, qs.stringify(grantBody), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      .catch(() => {
        throw new HttpException(
          {
            status: HttpStatus.UNAUTHORIZED,
            error: 'Access denied',
          },
          HttpStatus.UNAUTHORIZED,
        );
      });
  }

  async requestToken(issuer_s: string): Promise<any> {
    if (issuer_s === undefined || issuer_s === '') {
      throw new HttpException(
        'There was no issuer string passed to get the issuer',
        HttpStatus.BAD_REQUEST,
      );
    }

    const issuer = await this.getIssuer(issuer_s).catch(() => {
      throw new HttpException(
        {
          status: HttpStatus.BAD_REQUEST,
          error: 'invalid issuer',
        },
        HttpStatus.BAD_REQUEST,
      );
    });

    const grantBody: GrantBody = {
      grant_type: process.env.CLIENT_CREDENTIALS_STRING,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      audience: process.env.AUDIENCE,
    };

    return await this.getToken(String(issuer.token_endpoint), grantBody);
  }

  async decodeToken(
    issuer: string,
    tokenString: string,
    getKeysFromProvider: boolean,
    keyMaterialAlgorithm: string,
    keyMaterialFilepath: string,
  ): Promise<[string, string]> {
    if (getKeysFromProvider) {
      const resultWithExternalMaterial =
        await this.decodeTokenWithExternalKeyMaterial(issuer, tokenString);

      return resultWithExternalMaterial;
    } else {
      const results = await this.decodeTokenWithKeyMaterialFile(
        issuer,
        tokenString,
        keyMaterialAlgorithm,
        keyMaterialFilepath,
      );

      return results;
    }
  }

  private async decodeTokenWithExternalKeyMaterial(
    issuer: string,
    token: string,
  ): Promise<[string, string]> {
    if (issuer === undefined || issuer === '') {
      throw new HttpException(
        'There was no issuer to validate the token against!',
        400,
      );
    }

    if (token === undefined || token === '') {
      throw new HttpException('There was no tokenString to decode!', 400);
    }

    const discoveryInformation = await this.helperService.get_issuer(issuer);
    const keyMaterialEndpoint = String(discoveryInformation['jwks_uri']);

    const key_material = jose.createRemoteJWKSet(new URL(keyMaterialEndpoint));

    const { payload, protectedHeader } = await jose.jwtVerify(
      token,
      key_material,
      {
        issuer: issuer,
      },
    );

    return [
      JSON.stringify(payload, undefined, 2),
      JSON.stringify(protectedHeader, undefined, 2),
    ];
  }

  async coloredFilteredValidation(issuer: object, schema: object) {
    let keys = [];
    for (const key in issuer) {
      keys.push(key);
    }
    return this.helperService.coloredFilteredValidationWithFileContent(issuer, schema, keys);
  }

  private async decodeTokenWithKeyMaterialFile(
    issuer: string,
    token: string,
    algorithm: string,
    filepath: string,
  ): Promise<[string, string]> {
    if (issuer === undefined || issuer === '') {
      throw new HttpException(
        'There was no issuer to validate the token against!',
        400,
      );
    }

    if (token === undefined || token === '') {
      throw new HttpException('There was no tokenString to decode!', 400);
    }

    if (algorithm === undefined || algorithm === '') {
      throw new HttpException('Missing algorithm!', 400);
    }

    if (filepath === undefined || filepath === '') {
      throw new HttpException('Invalid filepath!', 400);
    }

    if (!filepath.endsWith('.pem')) {
      throw new HttpException(
        'Unsupported file-type (Supported formats: .pem)',
        400,
      );
    }

    let payloadString = '';
    let protectedHeaderString = '';
    const data = fs.readFileSync(filepath, 'utf8');

    const key_material = await jose.importSPKI(data, algorithm);

    const { payload, protectedHeader } = await jose.jwtVerify(
      token,
      key_material,
      {
        issuer: issuer,
        algorithms: [algorithm]
      },
    );

    payloadString = JSON.stringify(payload, undefined, 2);
    protectedHeaderString = JSON.stringify(protectedHeader, undefined, 2);

    return [payloadString, protectedHeaderString];
  }

  getKeyAlgorithms() {
    const all_schemas = [ "", 
      "EdDSA",
      "ES256",
      "ES256K",
      "ES384",
      "ES512",
      "HS256",
      "HS384",
      "HS512",
      "PS256",
      "PS384",
      "PS512",
      "RS256",
      "RS384",
      "RS512",
    ];
    const default_algo = this.settingsService.config.token.key_algorithm;
    const default_list = [ default_algo ];
    return default_list.concat(all_schemas.filter((x) => { return x !== default_algo; }));
  }
}
