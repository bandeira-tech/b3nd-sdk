import type { PersistenceRecord, NavigationNode } from "../types";

// Mock persistence data following b3nd structure
export const mockPersistenceData: Record<string, PersistenceRecord> = {
  // Users protocol data
  "/users/nataliarsand/~>/pubkeys": {
    ts: Date.now() - 86400000, // 1 day ago
    data: [
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...",
    ],
  },
  "/users/nataliarsand/milestory.me/books": {
    ts: Date.now() - 3600000, // 1 hour ago
    data: ["book-1", "book-2", "book-3"],
  },
  "/users/nataliarsand/milestory.me/books/book-1/~>/writers": {
    ts: Date.now() - 7200000, // 2 hours ago
    data: ["nataliarsand", "collaborator-1"],
  },
  "/users/nataliarsand/milestory.me/books/book-1/entries/1": {
    ts: Date.now() - 1800000, // 30 minutes ago
    data: {
      title: "A Journey Begins",
      images: ["image-uuid-1.jpg", "image-uuid-2.jpg"],
      description:
        "The first entry in our adventure log, documenting the beginning of an incredible journey through the mountains.",
      location: "Mount Rainier National Park",
      weather: "Sunny, 72°F",
      mood: "excited",
    },
  },
  "/users/nataliarsand/milestory.me/books/book-1/entries/2": {
    ts: Date.now() - 900000, // 15 minutes ago
    data: {
      title: "Reaching Base Camp",
      images: ["image-uuid-3.jpg"],
      description:
        "After a long day of hiking, we finally reached base camp. The view is breathtaking!",
      location: "Paradise Valley",
      weather: "Partly cloudy, 68°F",
      mood: "accomplished",
    },
  },
  "/users/nataliarsand/myapp/memories": {
    ts: Date.now() - 300000, // 5 minutes ago
    data: [
      {
        id: "mem-1",
        img: "photo-uuid-1.jpg",
        txt: "Beach sunset with friends",
      },
      {
        id: "mem-2",
        img: "photo-uuid-2.jpg",
        txt: "Coffee shop morning routine",
      },
    ],
  },
  "/users/nataliarsand/plans/tokyo-2030": {
    ts: Date.now() - 600000, // 10 minutes ago
    data: "we going baby, it gone be good",
  },

  // Apps protocol data
  "/apps/milestory.me/~>/settings": {
    ts: Date.now() - 86400000,
    data: {
      theme: "dark",
      notifications: true,
      privacy: "friends-only",
      backup: {
        enabled: true,
        frequency: "daily",
        location: "s3://backup-bucket/milestory",
      },
    },
  },
  "/apps/milestory.me/templates/book": {
    ts: Date.now() - 172800000, // 2 days ago
    data: {
      fields: ["title", "images", "description", "location", "weather", "mood"],
      required: ["title", "description"],
      layout: "journal-style",
    },
  },
  "/apps/myapp/~>/config": {
    ts: Date.now() - 43200000, // 12 hours ago
    data: {
      appName: "Memory Keeper",
      version: "1.2.0",
      maxFileSize: "10MB",
      supportedFormats: ["jpg", "png", "gif", "mp4"],
    },
  },
};

// Helper to generate navigation tree structure
export function generateMockNavigationTree(): NavigationNode[] {
  return [
    {
      path: "/users",
      name: "users",
      type: "directory",
      children: [
        {
          path: "/users/nataliarsand",
          name: "nataliarsand",
          type: "directory",
          children: [
            {
              path: "/users/nataliarsand/~>",
              name: "~>",
              type: "directory",
              children: [
                {
                  path: "/users/nataliarsand/~>/pubkeys",
                  name: "pubkeys",
                  type: "file",
                  record: mockPersistenceData["/users/nataliarsand/~>/pubkeys"],
                },
              ],
            },
            {
              path: "/users/nataliarsand/milestory.me",
              name: "milestory.me",
              type: "directory",
              children: [
                {
                  path: "/users/nataliarsand/milestory.me/books",
                  name: "books",
                  type: "directory",
                  children: [
                    {
                      path: "/users/nataliarsand/milestory.me/books/book-1",
                      name: "book-1",
                      type: "directory",
                      children: [
                        {
                          path: "/users/nataliarsand/milestory.me/books/book-1/~>",
                          name: "~>",
                          type: "directory",
                          children: [
                            {
                              path: "/users/nataliarsand/milestory.me/books/book-1/~>/writers",
                              name: "writers",
                              type: "file",
                              record:
                                mockPersistenceData[
                                  "/users/nataliarsand/milestory.me/books/book-1/~>/writers"
                                ],
                            },
                          ],
                        },
                        {
                          path: "/users/nataliarsand/milestory.me/books/book-1/entries",
                          name: "entries",
                          type: "directory",
                          children: [
                            {
                              path: "/users/nataliarsand/milestory.me/books/book-1/entries/1",
                              name: "1",
                              type: "file",
                              record:
                                mockPersistenceData[
                                  "/users/nataliarsand/milestory.me/books/book-1/entries/1"
                                ],
                            },
                            {
                              path: "/users/nataliarsand/milestory.me/books/book-1/entries/2",
                              name: "2",
                              type: "file",
                              record:
                                mockPersistenceData[
                                  "/users/nataliarsand/milestory.me/books/book-1/entries/2"
                                ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              path: "/users/nataliarsand/myapp",
              name: "myapp",
              type: "directory",
              children: [
                {
                  path: "/users/nataliarsand/myapp/memories",
                  name: "memories",
                  type: "file",
                  record:
                    mockPersistenceData["/users/nataliarsand/myapp/memories"],
                },
              ],
            },
            {
              path: "/users/nataliarsand/plans",
              name: "plans",
              type: "directory",
              children: [
                {
                  path: "/users/nataliarsand/plans/tokyo-2030",
                  name: "tokyo-2030",
                  type: "file",
                  record:
                    mockPersistenceData["/users/nataliarsand/plans/tokyo-2030"],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      path: "/apps",
      name: "apps",
      type: "directory",
      children: [
        {
          path: "/apps/milestory.me",
          name: "milestory.me",
          type: "directory",
          children: [
            {
              path: "/apps/milestory.me/~>",
              name: "~>",
              type: "directory",
              children: [
                {
                  path: "/apps/milestory.me/~>/settings",
                  name: "settings",
                  type: "file",
                  record: mockPersistenceData["/apps/milestory.me/~>/settings"],
                },
              ],
            },
            {
              path: "/apps/milestory.me/templates",
              name: "templates",
              type: "directory",
              children: [
                {
                  path: "/apps/milestory.me/templates/book",
                  name: "book",
                  type: "file",
                  record:
                    mockPersistenceData["/apps/milestory.me/templates/book"],
                },
              ],
            },
          ],
        },
        {
          path: "/apps/myapp",
          name: "myapp",
          type: "directory",
          children: [
            {
              path: "/apps/myapp/~>",
              name: "~>",
              type: "directory",
              children: [
                {
                  path: "/apps/myapp/~>/config",
                  name: "config",
                  type: "file",
                  record: mockPersistenceData["/apps/myapp/~>/config"],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

// Mock schema data
export const mockSchema = {
  "users://": {
    description: "User data storage protocol",
    validation: "user-auth-required",
    structure: {
      "~>": "User metadata and settings",
      "[domain]": "Domain-specific user data",
    },
  },
  "apps://": {
    description: "Application data storage protocol",
    validation: "app-signature-required",
    structure: {
      "~>": "App configuration and metadata",
      "[path]": "Application-specific data paths",
    },
  },
};
