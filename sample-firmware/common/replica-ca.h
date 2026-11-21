#pragma once
#include <cstring>
#include "esp_partition.h"

// Reads the broker's trust anchor from the `replica_ca` data partition. The test harness writes a
// certificate authority generated for each run there, so no key or certificate is ever committed.
class ReplicaCa {
 public:
  static constexpr size_t CAPACITY = 4096;
  static constexpr uint8_t ERASED = 0xff;

  static const char *pem() {
    static char text[CAPACITY];
    const esp_partition_t *part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "replica_ca");
    if (part == nullptr) return "";
    esp_partition_read(part, 0, text, CAPACITY - 1);
    size_t length = 0;
    while (length < CAPACITY - 1 && text[length] != '\0' && static_cast<uint8_t>(text[length]) != ERASED) length++;
    text[length] = '\0';
    return text;
  }
};
