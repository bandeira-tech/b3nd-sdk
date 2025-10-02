/**

import type {

export class LocalStorageClient implements NodeProtocolInterface {


    // Check if localStorage is available

  /**

  /**
    // Find matching schema validation function

    // No schema defined for this URI, allow write

  /**
    // Look for exact matches first

    // Look for prefix matches (e.g., "users://" matches "users://alice/profile")


  /**

  /**

      // Validate against schema if present









      // Iterate through all localStorage keys

          // Apply pattern filter if specified

          // Determine if this is a directory or file
          // If there are other keys that start with this key + "/", it's a directory


      // Sort items
          // Get timestamps from stored data for comparison


      // Apply pagination


  /**

  /**
      // Ignore errors, return null




      // Check if localStorage is accessible



  /**




  /**
      // This is a rough estimate - localStorage limit is typically 5-10MB




    // Remove all keys with our prefix


    // Remove the keys