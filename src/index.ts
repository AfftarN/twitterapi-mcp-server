#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Interface definitions for TwitterAPI.io responses
 */
interface TwitterUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  verified?: boolean;
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  profile_image_url?: string;
  created_at?: string;
}

interface Tweet {
  id: string;
  text: string;
  author: TwitterUser;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
  };
  in_reply_to?: string;
  referenced_tweets?: Array<{
    type: 'retweeted' | 'quoted' | 'replied_to';
    id: string;
  }>;
}

interface SearchResponse {
  data: Tweet[];
  meta?: {
    result_count: number;
    next_token?: string;
  };
}

interface UserResponse {
  data: TwitterUser;
}

interface TweetsResponse {
  data: Tweet[];
}

/**
 * TwitterAPI.io MCP Server
 * Provides access to Twitter data through TwitterAPI.io service
 */
class TwitterAPIMCPServer {
  private server: Server;
  private apiClient: AxiosInstance;
  private apiKey: string;
  private loginCookie: string | null = null;

  constructor() {
    // Get API key from environment
    this.apiKey = process.env.TWITTERAPI_API_KEY || '';
    if (!this.apiKey) {
      console.error('Warning: TWITTERAPI_API_KEY environment variable not set');
    }

    this.server = new Server(
      {
        name: 'twitterapi-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Configure axios client with proxy support
    const axiosConfig: AxiosRequestConfig = {
      baseURL: 'https://api.twitterapi.io/twitter',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TwitterAPI-MCP-Server/1.0.0'
      }
    };

    // Proxy support for enterprise environments
    const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
    if (proxyUrl) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
      axiosConfig.proxy = false;
      console.log('Using proxy:', proxyUrl);
    }

    this.apiClient = axios.create(axiosConfig);

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_user_by_username',
            description: 'Get Twitter user information by username',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Twitter username (without @)',
                },
              },
              required: ['username'],
            },
          } as Tool,
          {
            name: 'get_user_by_id',
            description: 'Get Twitter user information by user ID',
            inputSchema: {
              type: 'object',
              properties: {
                user_id: {
                  type: 'string',
                  description: 'Twitter user ID',
                },
              },
              required: ['user_id'],
            },
          } as Tool,
          {
            name: 'get_user_tweets',
            description: 'Get tweets from a specific user (returns up to 20 per page)',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Twitter username (without @)',
                },
                userId: {
                  type: 'string',
                  description: 'Twitter user ID (alternative to username)',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
                includeReplies: {
                  type: 'boolean',
                  description: 'Include reply tweets (default: false)',
                  default: false,
                },
              },
              required: [],
            },
          } as Tool,
          {
            name: 'search_tweets',
            description: 'Search for tweets using keywords',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for tweets (e.g., "AI" OR "Twitter" from:elonmusk since:2021-12-31)',
                },
                queryType: {
                  type: 'string',
                  description: 'Type of search results',
                  enum: ['Latest', 'Top'],
                  default: 'Latest',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page (empty string for first page)',
                },
              },
              required: ['query'],
            },
          } as Tool,
          {
            name: 'get_tweet_by_id',
            description: 'Get one or more tweets by their IDs',
            inputSchema: {
              type: 'object',
              properties: {
                tweet_ids: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of Twitter tweet IDs to retrieve',
                },
              },
              required: ['tweet_ids'],
            },
          } as Tool,
          {
            name: 'get_tweet_replies',
            description: 'Get replies to a specific tweet (returns up to 20 per page)',
            inputSchema: {
              type: 'object',
              properties: {
                tweetId: {
                  type: 'string',
                  description: 'Twitter tweet ID (must be an original tweet, not a reply)',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
                queryType: {
                  type: 'string',
                  description: 'Sort order for replies',
                  enum: ['Relevance', 'Latest', 'Likes'],
                  default: 'Relevance',
                },
              },
              required: ['tweetId'],
            },
          } as Tool,
          {
            name: 'get_user_followers',
            description: 'Get followers of a specific user (returns up to 200 per page)',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Twitter username (without @)',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
                pageSize: {
                  type: 'integer',
                  description: 'Number of followers per page (default: 200, max: 200)',
                  minimum: 1,
                  maximum: 200,
                },
              },
              required: ['username'],
            },
          } as Tool,
          {
            name: 'get_user_following',
            description: 'Get users that a specific user is following (returns up to 200 per page)',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Twitter username (without @)',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
                pageSize: {
                  type: 'integer',
                  description: 'Number of following per page (default: 200, max: 200)',
                  minimum: 1,
                  maximum: 200,
                },
              },
              required: ['username'],
            },
          } as Tool,
          {
            name: 'search_users',
            description: 'Search for Twitter users by keyword',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search keyword for finding users',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
              },
              required: ['query'],
            },
          } as Tool,
          {
            name: 'login_user',
            description: 'Login to Twitter account for write actions (posting tweets, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                user_name: {
                  type: 'string',
                  description: 'Twitter username',
                },
                email: {
                  type: 'string',
                  description: 'Email associated with Twitter account',
                },
                password: {
                  type: 'string',
                  description: 'Twitter password',
                },
                proxy: {
                  type: 'string',
                  description: 'High-quality residential proxy in format: http://username:password@ip:port',
                },
                totp_secret: {
                  type: 'string',
                  description: '2FA secret from user profile (optional, improves login reliability)',
                },
              },
              required: ['user_name', 'email', 'password', 'proxy'],
            },
          } as Tool,
          {
            name: 'create_tweet',
            description: 'Create a new tweet (requires login first)',
            inputSchema: {
              type: 'object',
              properties: {
                tweet_text: {
                  type: 'string',
                  description: 'Tweet text content (max 280 characters)',
                  maxLength: 280,
                },
                proxy: {
                  type: 'string',
                  description: 'Proxy configuration (same proxy used for login)',
                },
                reply_to_tweet_id: {
                  type: 'string',
                  description: 'Tweet ID to reply to (optional)',
                },
                attachment_url: {
                  type: 'string',
                  description: 'URL for attached content (optional)',
                },
                media_ids: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of media IDs to attach (optional)',
                },
              },
              required: ['tweet_text', 'proxy'],
            },
          } as Tool,
          {
            name: 'get_tweet_quotes',
            description: 'Get quote tweets of a specific tweet',
            inputSchema: {
              type: 'object',
              properties: {
                tweetId: {
                  type: 'string',
                  description: 'Twitter tweet ID',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
              },
              required: ['tweetId'],
            },
          } as Tool,
          {
            name: 'get_tweet_retweeters',
            description: 'Get users who retweeted a specific tweet',
            inputSchema: {
              type: 'object',
              properties: {
                tweetId: {
                  type: 'string',
                  description: 'Twitter tweet ID',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
              },
              required: ['tweetId'],
            },
          } as Tool,
          {
            name: 'get_tweet_thread',
            description: 'Get full thread context of a tweet (parents and branches)',
            inputSchema: {
              type: 'object',
              properties: {
                tweetId: {
                  type: 'string',
                  description: 'Twitter tweet ID',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
              },
              required: ['tweetId'],
            },
          } as Tool,
          {
            name: 'get_user_mentions',
            description: 'Get tweets mentioning a specific user',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Twitter username (without @)',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
                queryType: {
                  type: 'string',
                  description: 'Sort order for results',
                  enum: ['Latest', 'Top'],
                  default: 'Latest',
                },
              },
              required: ['username'],
            },
          } as Tool,
          {
            name: 'get_trends',
            description: 'Get trending topics by region (1 = worldwide, 23424977 = US)',
            inputSchema: {
              type: 'object',
              properties: {
                woeid: {
                  type: 'string',
                  description: 'Region ID, digits only (1 = worldwide)',
                },
                count: {
                  type: 'integer',
                  description: 'Number of trends to return (default: 30)',
                },
              },
              required: ['woeid'],
            },
          } as Tool,
          {
            name: 'get_follow_relationship',
            description: 'Check follow relationship between two users',
            inputSchema: {
              type: 'object',
              properties: {
                source_username: {
                  type: 'string',
                  description: 'Twitter username of the source user (without @)',
                },
                target_username: {
                  type: 'string',
                  description: 'Twitter username of the target user (without @)',
                },
              },
              required: ['source_username', 'target_username'],
            },
          } as Tool,
          {
            name: 'get_users_by_ids',
            description: 'Get multiple user profiles by their IDs',
            inputSchema: {
              type: 'object',
              properties: {
                user_ids: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of Twitter user IDs to retrieve',
                },
              },
              required: ['user_ids'],
            },
          } as Tool,
          {
            name: 'get_article',
            description: 'Get article content attached to a tweet',
            inputSchema: {
              type: 'object',
              properties: {
                tweet_id: {
                  type: 'string',
                  description: 'Twitter tweet ID',
                },
              },
              required: ['tweet_id'],
            },
          } as Tool,
          {
            name: 'get_user_timeline',
            description: 'Get full tweet timeline of a user by ID (with optional replies and parent tweets)',
            inputSchema: {
              type: 'object',
              properties: {
                user_id: {
                  type: 'string',
                  description: 'Twitter user ID (digits only)',
                },
                cursor: {
                  type: 'string',
                  description: 'Pagination cursor for fetching next page',
                },
                includeReplies: {
                  type: 'boolean',
                  description: 'Include reply tweets (default: false)',
                  default: false,
                },
                includeParentTweet: {
                  type: 'boolean',
                  description: 'Include parent tweets (default: false)',
                  default: false,
                },
              },
              required: ['user_id'],
            },
          } as Tool,
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;
        
        if (!args) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing arguments');
        }

        switch (name) {
          case 'get_user_by_username':
            return await this.getUserByUsername(args.username as string);

          case 'get_user_by_id':
            return await this.getUserById(args.user_id as string);

          case 'get_user_tweets':
            return await this.getUserTweets(
              args.username as string,
              args.userId as string,
              args.cursor as string,
              args.includeReplies as boolean
            );

          case 'search_tweets':
            return await this.searchTweets(
              args.query as string,
              args.queryType as string,
              args.cursor as string
            );

          case 'get_tweet_by_id':
            return await this.getTweetById(args.tweet_ids as string[]);

          case 'get_tweet_replies':
            return await this.getTweetReplies(
              args.tweetId as string,
              args.cursor as string,
              (args.queryType as string) || 'Relevance'
            );

          case 'get_tweet_quotes':
            return await this.getTweetQuotes(
              args.tweetId as string,
              args.cursor as string
            );

          case 'get_tweet_retweeters':
            return await this.getTweetRetweeters(
              args.tweetId as string,
              args.cursor as string
            );

          case 'get_tweet_thread':
            return await this.getTweetThread(
              args.tweetId as string,
              args.cursor as string
            );

          case 'get_user_mentions':
            return await this.getUserMentions(
              args.username as string,
              args.cursor as string,
              (args.queryType as string) || 'Latest'
            );

          case 'get_trends':
            return await this.getTrends(
              args.woeid as string,
              args.count as number
            );

          case 'get_follow_relationship':
            return await this.getFollowRelationship(
              args.source_username as string,
              args.target_username as string
            );

          case 'get_users_by_ids':
            return await this.getUsersByIds(args.user_ids as string[]);

          case 'get_article':
            return await this.getArticle(args.tweet_id as string);

          case 'get_user_timeline':
            return await this.getUserTimeline(
              args.user_id as string,
              args.cursor as string,
              args.includeReplies as boolean,
              args.includeParentTweet as boolean
            );

          case 'get_user_followers':
            return await this.getUserFollowers(
              args.username as string,
              args.cursor as string,
              args.pageSize as number
            );

          case 'get_user_following':
            return await this.getUserFollowing(
              args.username as string,
              args.cursor as string,
              args.pageSize as number
            );

          case 'search_users':
            return await this.searchUsers(
              args.query as string,
              args.cursor as string
            );

          case 'login_user':
            return await this.loginUser(
              args.user_name as string,
              args.email as string,
              args.password as string,
              args.proxy as string,
              args.totp_secret as string
            );

          case 'create_tweet':
            return await this.createTweet(
              args.tweet_text as string,
              args.proxy as string,
              args.reply_to_tweet_id as string,
              args.attachment_url as string,
              args.media_ids as string[]
            );

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new McpError(ErrorCode.InternalError, `TwitterAPI.io error: ${message}`);
      }
    });
  }

  private async makeRequest(endpoint: string, params?: Record<string, any>): Promise<any> {
    try {
      const config: AxiosRequestConfig = {
        headers: {},
        params: params || {},
      };

      // Add API key if available
      if (this.apiKey && config.headers) {
        config.headers['x-api-key'] = this.apiKey;
      }

      // Add login cookie for write actions
      if (this.loginCookie && config.headers) {
        config.headers['Cookie'] = this.loginCookie;
      }

      const response = await this.apiClient.get(endpoint, config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.error || error.message;
        throw new Error(`TwitterAPI.io API error (${statusCode}): ${errorMessage}`);
      }
      throw error;
    }
  }

  private async makePostRequest(endpoint: string, data: Record<string, any>): Promise<any> {
    try {
      const config: AxiosRequestConfig = {
        headers: {},
      };

      // Add API key if available
      if (this.apiKey && config.headers) {
        config.headers['x-api-key'] = this.apiKey;
      }

      // Add login cookie for write actions
      if (this.loginCookie && config.headers) {
        config.headers['Cookie'] = this.loginCookie;
      }

      const response = await this.apiClient.post(endpoint, data, config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.error || error.message;
        throw new Error(`TwitterAPI.io API error (${statusCode}): ${errorMessage}`);
      }
      throw error;
    }
  }

  private async getUserByUsername(username: string): Promise<CallToolResult> {
    const data = await this.makeRequest(`/user/info`, { userName: username });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getUserById(userId: string): Promise<CallToolResult> {
    const data = await this.makeRequest(`/user/info`, { user_id: userId });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getUserTweets(
    username?: string,
    userId?: string,
    cursor?: string,
    includeReplies: boolean = false
  ): Promise<CallToolResult> {
    if (!username && !userId) {
      throw new Error('Either username or userId must be provided');
    }

    const params: Record<string, any> = {};
    if (username) params.userName = username;
    if (userId) params.userId = userId;
    if (cursor) params.cursor = cursor;
    params.includeReplies = includeReplies;

    const data = await this.makeRequest(`/user/last_tweets`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async searchTweets(
    query: string,
    queryType: string = 'Latest',
    cursor?: string
  ): Promise<CallToolResult> {
    const params: Record<string, any> = {
      query,
      queryType,
    };
    if (cursor) {
      params.cursor = cursor;
    }
    const data = await this.makeRequest(`/tweet/advanced_search`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getTweetById(tweetIds: string[]): Promise<CallToolResult> {
    // API expects comma-separated string
    const data = await this.makeRequest(`/tweets`, { tweet_ids: tweetIds.join(',') });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getTweetReplies(
    tweetId: string,
    cursor?: string,
    queryType?: string
  ): Promise<CallToolResult> {
    const params: Record<string, any> = { tweetId };
    if (cursor) params.cursor = cursor;
    if (queryType) params.queryType = queryType;

    const data = await this.makeRequest(`/tweet/replies/v2`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getTweetQuotes(
    tweetId: string,
    cursor?: string
  ): Promise<CallToolResult> {
    const params: Record<string, any> = { tweetId };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/tweet/quotes`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getTweetRetweeters(
    tweetId: string,
    cursor?: string
  ): Promise<CallToolResult> {
    const params: Record<string, any> = { tweetId };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/tweet/retweeters`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getTweetThread(
    tweetId: string,
    cursor?: string
  ): Promise<CallToolResult> {
    const params: Record<string, any> = { tweetId };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/tweet/thread_context`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getUserMentions(
    username: string,
    cursor?: string,
    queryType: string = 'Latest'
  ): Promise<CallToolResult> {
    const params: Record<string, any> = { userName: username, queryType };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/user/mentions`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getTrends(
    woeid: string,
    count?: number
  ): Promise<CallToolResult> {
    const params: Record<string, any> = { woeid };
    if (count) params.count = count;

    const data = await this.makeRequest(`/trends`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getFollowRelationship(
    sourceUsername: string,
    targetUsername: string
  ): Promise<CallToolResult> {
    const data = await this.makeRequest(`/user/check_follow_relationship`, {
      source_user_name: sourceUsername,
      target_user_name: targetUsername,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getUsersByIds(userIds: string[]): Promise<CallToolResult> {
    // API expects comma-separated string
    const data = await this.makeRequest(`/user/batch_info_by_ids`, {
      userIds: userIds.join(','),
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getArticle(tweetId: string): Promise<CallToolResult> {
    const data = await this.makeRequest(`/article`, { tweet_id: tweetId });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getUserTimeline(
    userId: string,
    cursor?: string,
    includeReplies: boolean = false,
    includeParentTweet: boolean = false
  ): Promise<CallToolResult> {
    const params: Record<string, any> = {
      userId,
      includeReplies,
      includeParentTweet,
    };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/user/tweet_timeline`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getUserFollowers(
    username: string,
    cursor?: string,
    pageSize: number = 200
  ): Promise<CallToolResult> {
    const params: Record<string, any> = {
      userName: username,
      pageSize: Math.min(pageSize, 200),
    };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/user/followers`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async getUserFollowing(
    username: string,
    cursor?: string,
    pageSize: number = 200
  ): Promise<CallToolResult> {
    const params: Record<string, any> = {
      userName: username,
      pageSize: Math.min(pageSize, 200),
    };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/user/followings`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async searchUsers(query: string, cursor?: string): Promise<CallToolResult> {
    const params: Record<string, any> = { query };
    if (cursor) params.cursor = cursor;

    const data = await this.makeRequest(`/user/search`, params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async loginUser(
    userName: string,
    email: string,
    password: string,
    proxy: string,
    totpSecret?: string
  ): Promise<CallToolResult> {
    try {
      const loginPayload: Record<string, any> = {
        user_name: userName,
        email,
        password,
        proxy,
      };
      if (totpSecret) {
        loginPayload.totp_secret = totpSecret;
      }

      const loginData = await this.makePostRequest('/user_login_v2', loginPayload);

      // Store login cookie for future requests (API returns login_cookie)
      if (loginData.login_cookie) {
        this.loginCookie = loginData.login_cookie;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: loginData.status === 'success',
              message: loginData.msg || 'Login successful',
              login_cookie: loginData.login_cookie,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Login failed',
            }, null, 2),
          },
        ],
      };
    }
  }

  private async createTweet(
    tweetText: string,
    proxy: string,
    replyToTweetId?: string,
    attachmentUrl?: string,
    mediaIds?: string[]
  ): Promise<CallToolResult> {
    if (!this.loginCookie) {
      throw new Error('Must login first before creating tweets');
    }

    const tweetData: Record<string, any> = {
      login_cookies: this.loginCookie,
      tweet_text: tweetText,
      proxy,
    };
    if (replyToTweetId) {
      tweetData.reply_to_tweet_id = replyToTweetId;
    }
    if (attachmentUrl) {
      tweetData.attachment_url = attachmentUrl;
    }
    if (mediaIds && mediaIds.length > 0) {
      tweetData.media_ids = mediaIds;
    }

    const data = await this.makePostRequest('/create_tweet_v2', tweetData);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('TwitterAPI.io MCP server running on stdio');
  }
}

const server = new TwitterAPIMCPServer();
server.run().catch(console.error);